/**
 * move.drop.test.js — a drag writes nothing until its drop (A1 C2, PLAN §1.4, §1.7; B-DRAG). Per drag
 * event: no document event, no re-home, no table set, no frame minted or re-addressed, no settle; the
 * held natives are drawn, hit and placed at the pointer's delta through the Stage. At the drop: one
 * write and one op, the frames minted there the final chains' only (A1 §1.4's census, against the
 * frozen model that wrote every event). A cancel leaves the document byte-equal to before the press
 * and merges nothing. The drop's patch has a user's budget, like an undo (PLAN §5.15 item 2).
 */
import { useEngines, mkEngine } from "./__testkit__/harness";
import OracleEngine from "./__oracles__/model-v1/KobinEngine";
import { rectLoop } from "./geometry/arcShape";

useEngines();

const shapeAt = (E, frame, x, y, w, h) => {
    const o = { type: "shape", origin: "native", id: E.doc.allocId(), color: "#123", opacity: 1, w: 8,
        loops: rectLoop({ left: x, top: y, right: x + w, bottom: y + h }) };
    E.doc.add(o, frame);
    return o;
};
const rects = (E, frame, n, seed) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const x = ((i * 7919 + seed) % 40000) - 20000, y = ((i * 104729 + seed) % 40000) - 20000;
        ids.push(shapeAt(E, frame, x, y, 50 + (i % 900), 40).id);
    }
    return ids;
};
// A1 §1.4's fixture: the camera at depth 1 in "1"; a root R a level under it, 6 kids two levels under, 18
// grandkids three under, `n` natives a frame; and two loose squares in "1", 40 units a side, on screen.
function fixture(Engine = null, n = 50) {
    const E = Engine ? mkOracle(Engine) : mkEngine(800, 600);
    E.lm.ensureSpine(4);
    E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
    const R = E.lm.cellChild("1", 5, 5);
    const frames = [R.id];
    rects(E, R.id, n, 1);
    for (let k = 0; k < 6; k++) {
        const K = E.lm.cellChild(R.id, 7 * k - 17, 3 * k - 8);
        frames.push(K.id); rects(E, K.id, n, 10 + k);
        for (let g = 0; g < 3; g++) { const L = E.lm.cellChild(K.id, g - 1, 2 * g - 2); frames.push(L.id); rects(E, L.id, n, 100 + 10 * k + g); }
    }
    const a = shapeAt(E, "1", -200, -100, 40, 40), b = shapeAt(E, "1", -140, -100, 40, 40);
    E._render();
    return { E, R, frames, a, b };
}
const oracles = [];
function mkOracle(Engine) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const E = new Engine(host, { width: 800, height: 600, scenes: false });
    oracles.push({ E, host });
    return E;
}
afterEach(() => { while (oracles.length) { const o = oracles.pop(); try { o.E.destroy(); } catch (e) { /* gone */ } o.host.remove(); } });

const bytes = (E) => {
    const n = E.doc.serializeNatives();
    return JSON.stringify(Object.keys(n).sort().map((k) => [k, n[k].slice().sort((p, q) => p.id - q.id)]));
};
const state = (E) => bytes(E) + JSON.stringify(E.lm.serialize());
/** Everything a write moves: the document's revisions, the lattice's epoch and size, the undo stack. */
const marks = (E) => [E.doc.rev, E.doc.offRev, E.lm.addrEpoch, E.lm.frames.size, E.doc._undo.length].join("|");
/** A press on a selected square's ink (per-object) or on the selected frame's mark. */
const pressOn = (E, what) => (typeof what === "string" ? E._levelPointToScreen(what, 0, 0) : E._levelPointToScreen("1", what.x, what.y));

describe("D1 — per drag event: no write, no re-home, no mint, no settle (the counters)", () => {
    for (const [name, pick] of [
        ["per-object", (f) => ({ ids: [f.a.id, f.b.id], frames: [], at: { x: -180, y: -80 } })],
        ["a selected frame", (f) => ({ ids: [], frames: [f.R.id], at: f.R.id })],
        ["both", (f) => ({ ids: [f.a.id, f.b.id], frames: [f.R.id], at: { x: -180, y: -80 } })],
    ]) {
        test(name + ": 40 events, every counter 0; the held natives drawn at the delta", () => {
            const f = fixture();
            const { E } = f, sel = pick(f);
            E._setSelection(sel.ids, sel.frames);
            E.setTool("select");
            const events = [];
            const off = E.doc.subscribe((ev) => events.push(ev));
            const p = pressOn(E, sel.at);
            E.pointerDown(p[0], p[1]);
            const m0 = marks(E), s0 = state(E);
            const perEvent = [];
            for (let k = 1; k <= 40; k++) {
                const n0 = events.length;
                E.pointerMove(p[0] + 7 * k, p[1] + 3 * k);
                const evs = events.slice(n0);
                perEvent.push([evs.length, evs.filter((ev) => ev.rehome != null).length, evs.filter((ev) => ev.kind === "settle").length]);
            }
            off();
            expect(E._dragSel && E._holdMove).toBeTruthy();
            expect(perEvent.every((c) => c[0] === 0 && c[1] === 0 && c[2] === 0)).toBe(true);   // red: a write in a drag step
            expect(marks(E)).toBe(m0);                                     // no rev, table, address, frame or op
            expect(state(E)).toBe(s0);
            // The Stage draws the held natives at the pointer's delta: 280, 120 units at inScale 1.
            const it = E.stage.itemsOf(f.a.id)[0];
            if (sel.ids.length) {
                expect(E.stage.placed(it).off).toEqual([it.off[0] + 280, it.off[1] + 120]);
                expect(E.stage.atRest(() => E.stage.placed(it).off)).toEqual(it.off);
            } else expect(E.stage.placed(it).off).toEqual(it.off);         // not held: where it is
            E.pointerUp();
            expect(E.doc._undo.length).toBe(1);                            // the drop: one op
        });
    }
});

describe("D2 — the drop: one write, one op; mints at the drop are the final chains' (A1 §1.4)", () => {
    // A1 §1.4's census (its E1): kids and grandkids at seeded cells within ±2,000 of their parents' grids, a
    // seeded walk of 40 steps of 7 px, a render each; frames minted during the drag (their most at once) and
    // left after the drop's frame GC, the frozen model (which wrote every event) against the live one.
    const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    function censusFixture(Engine, seed) {
        const rnd = lcg(seed);
        const E = Engine ? mkOracle(Engine) : mkEngine(800, 600);
        E.lm.ensureSpine(4);
        E.cam.set({ activeLevel: 1, frame: "1", inScale: 1, inPanX: 400, inPanY: 300 });
        const R = E.lm.cellChild("1", 5, 5);
        rects(E, R.id, 50, 1);
        for (let a = 0; a < 6; a++) {
            const K = E.lm.cellChild(R.id, Math.round((rnd() - 0.5) * 4000), Math.round((rnd() - 0.5) * 4000));
            rects(E, K.id, 50, 10 + a);
            for (let b = 0; b < 3; b++) rects(E, E.lm.cellChild(K.id, Math.round((rnd() - 0.5) * 4000), Math.round((rnd() - 0.5) * 4000)).id, 50, 100 + 10 * a + b);
        }
        E._render();
        return { E, R, rnd };
    }
    function census({ E, R, rnd }) {
        E._setSelection([], [R.id]);
        E.setTool("select");
        const p = pressOn(E, R.id), n0 = E.lm.frames.size;
        E.pointerDown(p[0], p[1]);
        let x = p[0], y = p[1], most = 0;
        for (let s = 0; s < 40; s++) {
            x += (rnd() - 0.3) * 7; y += (rnd() - 0.4) * 7;
            E.pointerMove(x, y);
            E._render();
            most = Math.max(most, E.lm.frames.size - n0);
        }
        const beforeDrop = E.lm.frames.size;
        E.pointerUp();
        return { during: most, atDrop: E.lm.frames.size - beforeDrop, left: E.lm.frames.size - n0 };
    }
    test("a 40 × 7 px subtree drag: the frozen model mints a trail, the drop only the final scaffolding", () => {
        const out = [];
        for (const seed of [12345, 777, 4242]) {
            const L = censusFixture(null, seed), O = censusFixture(OracleEngine, seed);
            const live = census(L), oracle = census(O);
            out.push({ seed, oracle: { during: oracle.during, left: oracle.left }, live: { during: live.during, left: live.left } });
            expect(live.during).toBe(0);                                   // red: a mint in a drag step
            expect(live.left).toBeLessThanOrEqual(oracle.left);            // the oracle keeps an emptied cell its trail shadowed
            expect(L.E.doc._undo.length).toBe(1);
            expect(L.E.doc._undo[0].op).toBe("moveFrames");
        }
        // eslint-disable-next-line no-console
        console.log("DROP-CENSUS " + JSON.stringify(out));
        expect(out.some((c) => c.oracle.during > 20)).toBe(true);           // the fixture: the old drag minted a trail
    });

    test("the same walk lands every native where the per-object path puts it (registration, `move.subtree` t2)", () => {
        // Seed 777: the drag that wrote every event merged the mover into a container its own trail minted at
        // the final cell, and 400 of 1,250 natives landed a cell (32 units) off the per-object picture.
        for (const seed of [777, 12345, 99]) {
            const boxes = (perObject) => {
                const f = censusFixture(null, seed), { E, R, rnd } = f;
                const all = [];
                for (const k of E.doc.levels()) for (const o of E.doc.list(k)) all.push(o.id);
                if (perObject) E._setSelection(all, []); else E._setSelection([], [R.id]);
                const p = pressOn(E, R.id);
                let x = p[0], y = p[1];
                E._dragSel = { start: [p[0], p[1]], moved: false };
                for (let s = 0; s < 40; s++) { x += (rnd() - 0.3) * 7; y += (rnd() - 0.4) * 7; E._dragSelection(x, y); E._render(); }
                E.pointerUp();
                const out = new Map();
                for (const k of E.doc.levels()) for (const o of E.doc.list(k)) out.set(o.id, E.stage.placeNative(o, "1").box());
                return out;
            };
            const a = boxes(false), b = boxes(true);
            let off = 0;
            for (const [id, r] of a) { const q = b.get(id); if (!q || ["left", "top", "right", "bottom"].some((k) => r[k] !== q[k])) off++; }
            expect([seed, a.size, off]).toEqual([seed, 1250, 0]);          // red before B-DRAG: seed 777, 400 off by a cell
        }
    });

    test("the drop's write, the hold's release and its merges are one Stage commit", () => {
        const f = fixture();
        const { E } = f;
        E._setSelection([f.a.id], [f.R.id]);
        E.setTool("select");
        const p = pressOn(E, { x: -180, y: -80 });
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 10; k++) E.pointerMove(p[0] + 7 * k, p[1]);
        const commits = [];
        const off = E.stage.onCommit(() => commits.push({ ops: E.doc._undo.length, holding: E.stage.holding, rev: E.doc.rev }));
        const release = jest.spyOn(E.stage, "release");
        const rev0 = E.doc.rev;
        E.pointerUp();
        off();
        expect(release).toHaveBeenCalledTimes(1);
        expect(E.doc.rev).toBeGreaterThan(rev0);
        // The first commit after the press holds the whole drop: its op, the released hold, every write.
        expect(commits[0]).toEqual({ ops: 1, holding: false, rev: E.doc.rev });
    });
});

describe("D3 — a cancel writes nothing: the document is byte-equal to before the press", () => {
    for (const [name, cancel] of [
        ["a pinch (cancelSelectGesture)", (E) => E.cancelSelectGesture(false)],
        ["an undo mid-drag", (E) => E.undo()],
        ["a deselect", (E) => E.deselect()],
    ]) {
        test(name + ", after a drag across an occupied cell: no shadow, no merge, no op", () => {
            const f = fixture();
            const { E } = f;
            const B = E.lm.cellChild("1", 7, 5);                           // two cells over: the old drag shadowed it on the way
            rects(E, B.id, 20, 7);
            E._render();
            E._setSelection([], [f.R.id]);
            E.setTool("select");
            const before = state(E), undo0 = E.doc._undo.length;
            const merge = jest.spyOn(E.doc, "mergePending");
            const p = pressOn(E, f.R.id);
            E.pointerDown(p[0], p[1]);
            for (let k = 1; k <= 12; k++) E.pointerMove(p[0] + 6 * k, p[1]);   // 72 units: across (7, 5)
            expect(state(E)).toBe(before);
            cancel(E);
            expect(E._dragSel).toBeNull();
            expect(E.stage.holding).toBe(false);
            expect(state(E)).toBe(before);                                 // red: the drag's writes, or a shadow merged
            expect(merge).not.toHaveBeenCalled();                          // red: a merge without an op record
            expect(E.doc._undo.length).toBe(undo0);
            for (const fr of E.lm.frames.values()) expect(fr.shadowOf == null && !(fr._shadows && fr._shadows.size)).toBe(true);
        });
    }
});

describe("D4 — inputs during a drag read the held delta through the model", () => {
    test("a hit test finds the ink where the drag draws it, not where it rests; placeNative agrees", () => {
        const f = fixture();
        const { E, a } = f;
        E._setSelection([a.id], []);
        E.setTool("select");
        const p = pressOn(E, { x: -180, y: -80 });
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 10; k++) E.pointerMove(p[0], p[1] + 10 * k);   // 100 units down
        expect(E.hitTestAt(p[0], p[1] + 100)).toBe(a.id);                 // red: the hit test reads the rest
        expect(E.hitTestAt(p[0], p[1])).not.toBe(a.id);
        const box = E._rectInActive(a), rest = E.stage.atRest(() => E._rectInActive(a));
        expect(box.top - rest.top).toBe(100);
        expect(E.doc.getById(a.id).obj.below).toBeUndefined();            // and nothing was written
        E.pointerUp();
        expect(E.hitTestAt(p[0], p[1] + 100)).toBe(a.id);                 // the drop wrote it there
    });
});

describe("D5 — the view draws a drag the plane does not", () => {
    test("no plane (the SVG path): each delta change is one commit; the plane's drag commits none", () => {
        const f = fixture();
        const { E, a } = f;
        E._setSelection([a.id], []);
        E.setTool("select");
        const p = pressOn(E, { x: -180, y: -80 });
        E.pointerDown(p[0], p[1]);
        E.pointerMove(p[0] + 10, p[1]);
        expect(E._holdMove.plane).toBe(false);
        const G0 = E.stage.generation;
        for (let k = 2; k <= 6; k++) E.pointerMove(p[0] + 10 * k, p[1]);
        expect(E.stage.generation - G0).toBeGreaterThanOrEqual(5);        // red: the view never learns the delta moved
        const it = E.stage.itemsOf(a.id)[0];
        expect(it.res).toEqual([60, 0]);                                   // what paint applies: the held delta
        E.pointerUp();
        expect(E.stage.itemsOf(a.id)[0].res).toEqual([60, 0]);            // the drop's table, no delta
    });
});

describe("D6 — the drop is a user's action: its patch has one frame's budget (PLAN §5.15 item 2)", () => {
    test("noteUserEdit once, at the drop, after its commit", () => {
        const E = mkEngine(800, 600, { raster: true });
        const a = shapeAt(E, "0", -200, -100, 400, 400);
        E._render();
        E._setSelection([a.id], []);
        E.setTool("select");
        const note = jest.spyOn(E.renderer, "noteUserEdit");
        const p = E._levelPointToScreen("0", 0, 100);
        E.pointerDown(p[0], p[1]);
        for (let k = 1; k <= 6; k++) E.pointerMove(p[0] + 6 * k, p[1]);
        expect(note).not.toHaveBeenCalled();
        let G = -1;
        note.mockImplementation(() => { G = E.stage.generation; });
        E.pointerUp();
        expect(note).toHaveBeenCalledTimes(1);                             // red: the drop's patch took the bake's budget
        expect(G).toBeGreaterThan(0);
    });
});
