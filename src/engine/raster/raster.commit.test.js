/**
 * raster.commit.test.js — the pyramid in the task of a Stage commit (B-PYRAMID-4): a commit's patch step runs in the
 * task that made it — the next compose runs it, else a microtask — so no compose draws a plate the commit staled with
 * no patch asked (PLAN §5.15 item 1: scenario 7's `olderOtherMs` was stale own plates waiting for the bake's next render);
 * and a fast zoom-out's view strips are re-aimed at most AIM_LEVELS (2) past the view and never under the frame's floor
 * (F134: levels −14…−21 and 5–102 s a plate in jsdom); and the pack's records, kept across the commits' lists, see a held
 * drag's placement and the drop's write (PLAN §5.15 item 1).
 */
import { useEngines, mkEngine, drawStroke, drag } from "../__testkit__/harness";
import { packJob, clearPackCaches } from "./rasterPack";
import { setRasterTransport, setRasterWorkerCount, resetRasterWorkerClient } from "./rasterWorkerClient";
import { runJob } from "../worker/rasterWorker";
import { resetRasterStats } from "./RasterRenderer";
import { ownFloor } from "./level";

useEngines();
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(E, frames = 6) {
    for (let k = 0; k < frames; k++) { E.renderer.syncCameraOnly(); for (let n = 0; n < 4; n++) await tick(); }
}
/** The pool, gated: every dispatch parks until `run` answers all through the shipped worker entry. */
function gate() {
    const parked = [];
    setRasterTransport((msg) => new Promise((resolve) => parked.push({ msg, resolve })));
    return {
        parked,
        async run() {
            while (parked.length) { const p = parked.shift(); const out = await runJob(p.msg); p.resolve(out.msg); }
            for (let n = 0; n < 6; n++) await tick();
        },
    };
}
async function drain(E, g) {
    const busy = () => { const r = E.renderer.queue.report(); return g.parked.length + r.queued.reduce((a, b) => a + b, 0) + r.inFlight.reduce((a, b) => a + b, 0); };
    for (let k = 0; k < 200 && busy(); k++) { await g.run(); await settle(E, 1); }
    return busy();
}
function cellsUnder(P, b) {
    const v = P.v, x0 = b.left * v.Zq, y0 = b.top * v.Zq, x1 = b.right * v.Zq, y1 = b.bottom * v.Zq;
    return P.cells.filter((c) => c.draws.some((d) => d.x0 < x1 && d.x1 > x0 && d.y0 < y1 && d.y1 > y0));
}
const patches = (pyr) => pyr.s.patchInline + pyr.s.patchCoarse + pyr.s.patchWorker;

beforeEach(() => { resetRasterWorkerClient(); setRasterWorkerCount(2); resetRasterStats(); });
afterEach(() => { setRasterTransport(null); resetRasterWorkerClient(); });

/** An exact screen with a stroke on it; `commit()` adds a fill over it — a commit no render follows, as a bake's. */
async function staleByCommit() {
    const g = gate();
    const E = mkEngine(800, 600, { raster: true }), R = E.renderer, pyr = R.pyramid, c0 = E.cam;
    drawStroke(E, [[100, 100], [220, 160], [340, 120], [460, 320]]);
    await settle(E, 2);
    expect(await drain(E, g)).toBe(0);
    const F = (sx, sy) => [(sx - c0.inPanX) / c0.inScale, (sy - c0.inPanY) / c0.inScale];
    const [a, b] = [F(200, 150), F(260, 190)];
    const box = { left: a[0], top: a[1], right: b[0], bottom: b[1] };
    const commit = () => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#0a0", opacity: 1,
        polys: [[a, [b[0], a[1]], b, [a[0], b[1]]]] }, "0");
    return { g, E, R, pyr, box, commit };
}

describe("a commit's patch step runs in its task (PLAN §5.15 item 1)", () => {
    test("a commit, then a compose in the same task: the cells it staled are drawn patched or with their patch asked, never other older", async () => {
        const { g, E, pyr, box, commit } = await staleByCommit();
        let now = 1e6;
        pyr._now = () => now;
        const n0 = patches(pyr);
        commit();
        const P = pyr.compose();
        expect(patches(pyr)).toBe(n0 + 1);
        const under = cellsUnder(P, box);
        expect(under.length).toBeGreaterThan(0);
        for (const c of under) for (const d of c.draws) expect([c.i, c.j, d.cls, d.cls !== "older" || !!d.wait]).toEqual([c.i, c.j, d.cls, true]);
        const other0 = pyr.s.olderOtherMs;
        now += 50;
        pyr.compose();
        expect(pyr.s.olderOtherMs).toBe(other0);
        expect(await drain(E, g)).toBe(0);
    });

    test("a commit with no compose or step after it: the patch step runs in a microtask of the commit's task", async () => {
        const { g, E, pyr, commit } = await staleByCommit();
        const n0 = patches(pyr);
        commit();
        expect(patches(pyr)).toBe(n0);                   // not in the hook: an undo's `noteUserEdit` follows its commit
        await Promise.resolve();
        expect(patches(pyr)).toBe(n0 + 1);
        expect(pyr.patchDue).toBe(false);
        expect(await drain(E, g)).toBe(0);
    });

    test("a commit while the tab is hidden (a desktop, before the release) runs no patch step in its task; the return to visible runs it", async () => {
        const { g, E, R, pyr, commit } = await staleByCommit();
        const vis = (v) => { Object.defineProperty(document, "visibilityState", { value: v, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); };
        R.store.phone = false;                           // jsdom's 0-px screen reads as a phone, which releases at once
        const n0 = patches(pyr);
        try {
            vis("hidden");
            commit();
            await Promise.resolve();
            expect([patches(pyr), pyr.patchDue, R.store.s.releases]).toEqual([n0, true, 0]);
            vis("visible");
            expect([patches(pyr), pyr.patchDue]).toEqual([n0 + 1, false]);
        } finally { vis("visible"); }
        expect(await drain(E, g)).toBe(0);
    });

    test("an undo still gets the user's budget: its commit's patch step waits for `noteUserEdit` and the render", async () => {
        const { g, E, pyr, commit } = await staleByCommit();
        commit();
        await settle(E, 1);
        expect(await drain(E, g)).toBe(0);
        E.undo();
        expect(pyr.lastPatch.budget).toBe(48);           // USER_COARSE_FRAMES × patchUserMs, not the bake's 6
        expect(await drain(E, g)).toBe(0);
    });
});

describe("an ask stands until its own job or a newer one answers (PLAN §5.22 item 3)", () => {
    test("one worker: a patch strip that fails, and one packed after a newer patch was asked, leave that patch's ask — never other older", async () => {
        setRasterWorkerCount(1);
        const { g, E, pyr } = await staleByCommit();
        pyr.cfg.patchInlineMs = pyr.cfg.patchUserMs = 0;            // every patch to the pool
        let now = 1e6;
        pyr._now = () => now;
        const c0 = E.cam, F = (sx, sy) => [(sx - c0.inPanX) / c0.inScale, (sy - c0.inPanY) / c0.inScale];
        const fillAt = (sx, sy, w) => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: "#0a0", opacity: 1,
            polys: [[F(sx, sy), F(sx + w, sy), F(sx + w, sy + w), F(sx, sy + w)]] }, "0");
        const waits = () => { pyr.compose(); now += 50; pyr.compose(); return pyr.s.olderOtherMs; };
        fillAt(200, 150, 10);                                        // G1: p1, dispatched to the one worker and parked
        for (let n = 0; n < 4; n++) await tick();
        expect(g.parked.length).toBe(1);
        fillAt(230, 170, 10);                                        // G2: p2 queued behind it
        await tick();
        fillAt(250, 150, 8);                                         // G3: p3 queued
        await tick();
        const other0 = waits();
        const p1 = g.parked.shift();                                 // p1 fails: p3's ask stands
        p1.resolve({ kind: "raster-error", jobId: p1.msg.jobId, frameSeq: p1.msg.frameSeq, err: "test" });
        for (let n = 0; n < 4; n++) await tick();
        expect(waits()).toBe(other0);
        expect(g.parked.length).toBe(1);                             // p2, packed at G3 with its clips of G1–G2's dirt
        const p2 = g.parked.shift(), out = await runJob(p2.msg);
        p2.resolve(out.msg);
        for (let n = 0; n < 4; n++) await tick();
        expect(waits()).toBe(other0);                                // landed short of G3's dirt: p3's ask stands
        expect(pyr.s.olderPatchMs).toBeGreaterThan(0);
        expect(await drain(E, g)).toBe(0);
        expect(waits()).toBe(other0);
    });
});

describe("the pack's records across lists see where an item is drawn (PLAN §5.15 item 1)", () => {
    test("held at a drag's delta the item packs at +δ, released at its home, dropped at its new home — each the pack a cold cache makes", () => {
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer, id = E.doc.allocId(), F = E.cam.frame;
        const a = E.cam.screenToFrame(300, 250), b = E.cam.screenToFrame(420, 330);
        E.doc.add({ type: "fill", origin: "native", id, color: "#c00", opacity: 1, polys: [[a, [b[0], a[1]], b, [a[0], b[1]]]] }, F);
        E._render();
        const v = R._view, opts = { plates: Int32Array.of(Math.floor(a[0] * v.Zq / 512), Math.floor(a[1] * v.Zq / 512)), q: 0, Zq: v.Zq, dpr: 1, cfg: E.cfg, paper: [255, 255, 255] };
        const place = (job) => { const k = Array.from(job.ids).indexOf(id); return [job.attr[k * 9], job.attr[k * 9 + 1], job.attr[k * 9 + 4], job.attr[k * 9 + 5]]; };
        const same = (x, y) => x.length === y.length && x.every((n, k) => n === y[k]);
        /** The warm pack of the Stage's list now, checked against a cold one; its item's box corner and res. */
        const packNow = () => {
            const warm = packJob(R._sceneList(), opts);
            clearPackCaches();
            const cold = packJob(R._sceneList().slice(), opts);
            expect([same(warm.attr, cold.attr), same(warm.geom, cold.geom), same(warm.meta, cold.meta)]).toEqual([true, true, true]);
            return place(warm);
        };
        const at0 = packNow();
        E.stage.hold({ ids: [id] });
        E.stage.setDragDelta([30, 20], { viewDraws: true });            // no plane: the view's plates draw the hold (Item.res)
        expect(packNow()).toEqual([at0[0] + 30, at0[1] + 20, 30, 20]);
        E.stage.setDragDelta([50, 0], { viewDraws: true });
        expect(packNow()).toEqual([at0[0] + 50, at0[1], 50, 0]);
        E.stage.release();                                                // no write: back at its home
        expect(packNow()).toEqual(at0);
        const s0 = E.cam.levelPointToScreen(F, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        drag(E, s0, [s0[0] + 40, s0[1] + 10]);                            // the drop writes the move
        E._render();
        const moved = packNow(), inScale = E.cam.inScale;
        expect([moved[0] - at0[0], moved[1] - at0[1]].map((x) => +(x * inScale).toFixed(6))).toEqual([40, 10]);   // the box, res applied
    });
});

describe("F134: the velocity rule's re-aim is bounded", () => {
    test("zoom-out steps under a millisecond apart re-aim view strips at most AIM_LEVELS past the view's level and never under the frame's floor", async () => {
        const g = gate();
        const E = mkEngine(800, 600, { raster: true }), R = E.renderer;
        const fill = (x, y, c) => E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: c, opacity: 1,
            polys: [[[x, y], [x + 120, y], [x + 120, y + 120], [x, y + 120]]] }, "0");
        fill(100, 200, "rgb(200,30,30)"); fill(300, 200, "rgb(30,30,200)");
        drawStroke(E, [[150, 150], [300, 250], [450, 180]]);
        await settle(E, 2);
        expect(await drain(E, g)).toBe(0);
        const sent = [], submit = R.queue.pool.submit;
        R.queue.pool.submit = (st) => {
            if (st.kind === "view") sent.push({ level: st.level, S: st.S, view: R._view.level });
            return submit(st);
        };
        // The flag's case, made deterministic: steps closer than 1 ms read as −1 octave a millisecond (the motion's dt is at
        // least 1 ms) and an arrival 40 ms out predicts 40 octaves.
        R.queue.jobMs = 40;
        for (let k = 0; k < 8; k++) E.zoomAt(400, 300, 1000);           // a halving a step
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.filter((s) => s.level < Math.max(ownFloor(s.S), s.view - 2))).toEqual([]);      // AIM_LEVELS
        const t0 = Date.now();
        expect(await drain(E, g)).toBe(0);
        expect(Date.now() - t0).toBeLessThan(30000);
    }, 60000);
});
