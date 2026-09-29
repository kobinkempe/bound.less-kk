/**
 * erase.parallel.test.js — A2 §4.7: the parallel bake leaves the serial bake's document, ids, steps
 * and log, under random op sequences: undo and redo mid-bake, a frame crossing with its descents, two
 * marks over one family, a tap and a drag parked on their barriers, new ink over a pending mark. The
 * parallel engine runs first through the interim pool (`eraseWorkerClient`) over fake workers that
 * answer out of order, die mid-cut (RW-1: the pool is replaced, the lost job runs inline in its turn)
 * or go silent until the watchdog replaces them; the serial engine then replays the same script
 * inline, brought to the parallel one's progress (pairs applied and marks spent) before each op, and
 * its document must equal the parallel one's after every op. `ERASE_FUZZ_SEEDS=n` runs n seeds.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, click, descend, topView } from "./__testkit__/harness";
import { OpLog } from "./oplog";
import { resetEraseWorkerClient, eraseWorkerStats, _checkEraseWatchdogForTests } from "./eraseWorkerClient";
import { setRasterWorkerCount, WATCHDOG_MS } from "./raster/rasterWorkerClient";
import { cutJob, unwireJob, wireResult } from "./eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "./eraseDescent";
import { lcg } from "./__testkit__/rasterLists";

useEngines();
jest.setTimeout(600000);

const later = (ms = 2) => new Promise((r) => setTimeout(r, ms));
const state = (E) => {
    const n = E.doc.serializeNatives(), out = [];
    for (const k of Object.keys(n).sort()) if (n[k].length) out.push([k, n[k].map((o) => JSON.stringify(o)).sort()]);
    return JSON.stringify(out);
};
const steps = (E) => E.doc._undo.concat(E.doc._redo).filter((op) => op.op === "eraseCommit")
    .map((op) => op.baked.map((st) => [st._seq, st._on, st.removed ? st.removed.obj.id : null, (st.pieces || []).map((p) => p.obj.id)]));
const cores = (n) => Object.defineProperty(navigator, "hardwareConcurrency", { value: n, configurable: true });

/** The fake erase workers: each job answered after a random delay, or its worker dies mid-cut, or goes silent. */
function fakePool(rnd, { die = 0.04, silent = 0.02 } = {}) {
    const t = { made: 0, died: 0, silent: 0, answered: 0, descentJobs: 0 };
    let first = true;
    global.Worker = class {
        constructor(url) {
            if (!String(url).includes("erase-worker")) throw new Error("no " + url + " in this test");
            t.made++; this.dead = false;
        }
        postMessage(m) {
            const fate = first ? 1 : rnd(), ms = 1 + Math.floor(rnd() * 9);
            if (m.kind === "descent") t.descentJobs++;
            first = false;
            if (fate < silent) { t.silent++; return; }                        // never answers: the watchdog's case
            setTimeout(() => {
                if (this.dead) return;
                if (fate < silent + die) { t.died++; this.onerror({ preventDefault() {} }); return; }
                const out = m.kind === "descent" ? wireDescentResult(descentJob(...Object.values(unwireDescent(m.job))))
                    : wireResult(cutJob(unwireJob(m.job)));
                t.answered++;
                this.onmessage({ data: { id: m.id, ok: true, out: out.msg } });
            }, ms);
        }
        terminate() { this.dead = true; }
    };
    return t;
}

/** The pool's watchdog, run twice past WATCHDOG_MS on a mocked clock: a silent job's pool is replaced. */
function watchdog() {
    const t0 = performance.now(), spy = jest.spyOn(performance, "now").mockImplementation(() => t0 + WATCHDOG_MS + 1);
    try { _checkEraseWatchdogForTests(); _checkEraseWatchdogForTests(); } finally { spy.mockRestore(); }
}

/** Pairs applied and marks spent: the serial order's position. */
function progress(E) {
    const c = { n: 0 }, apply = E._applyPair.bind(E), spend = E._spendMark.bind(E);
    E._applyPair = (...a) => { c.n++; return apply(...a); };
    E._spendMark = (...a) => { c.n++; return spend(...a); };
    return c;
}

/** A seeded world and script: ink at the root, two marks through one object first, then random ops. */
function script(seed) {
    const rnd = lcg(seed), rr = (a, b) => a + rnd() * (b - a);
    const world = [];
    for (let k = 0; k < 6; k++) {
        const x = rr(160, 520), y = rr(160, 380), w = rr(60, 220), h = rr(30, 140);
        world.push({ kind: rnd() < 0.55 ? "fill" : "stroke", x, y, w, h, color: "rgb(" + (30 + 30 * k) + "," + Math.floor(rr(40, 200)) + ",140)" });
    }
    const c = world[0], cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const ops = [
        { k: "erase", pts: [[cx - 80, cy - 60], [cx + 80, cy + 60]], size: 14 },
        { k: "erase", pts: [[cx + 70, cy - 70], [cx - 70, cy + 70]], size: 22 },   // two marks over one family
    ];
    let level = 0;
    for (let n = 0; n < 12; n++) {
        const r = rnd();
        if (r < 0.26) ops.push({ k: "erase", pts: [[rr(150, 650), rr(150, 450)], [rr(150, 650), rr(150, 450)]], size: 8 + Math.floor(rnd() * 24) });
        else if (r < 0.48) ops.push({ k: "bake", ticks: 1 + Math.floor(rnd() * 5) });
        else if (r < 0.58) ops.push({ k: "undo" });
        else if (r < 0.66) ops.push({ k: "redo" });
        else if (r < 0.74) ops.push({ k: "tap", at: [rr(200, 600), rr(200, 400)] });
        else if (r < 0.80) ops.push({ k: "drag", from: [rr(200, 600), rr(200, 400)], by: [rr(-80, 80), rr(-60, 60)] });
        else if (r < 0.86) ops.push({ k: "ink", pts: [[rr(200, 600), rr(200, 400)], [rr(200, 600), rr(200, 400)]] });
        else if (r < 0.94 && level === 0) {                                  // a crossing, and an erase there: the descents
            const w = world[Math.floor(rnd() * world.length)], at = [w.x + w.w / 2, w.y + w.h / 2];
            ops.push({ k: "descend", at }, { k: "erase", pts: [[at[0] - 40, at[1] - 50], [at[0] + 40, at[1] + 50]], size: 30 });
            level = 1;
        } else if (level === 1) { ops.push({ k: "top" }); level = 0; }
    }
    return { world, ops };
}

function build(E, world) {
    E._scheduleBake = () => {};
    for (const o of world) {
        if (o.kind === "fill") E.doc.add({ type: "fill", origin: "native", id: E.doc.allocId(), color: o.color, opacity: 1, polys: [[[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]]] }, "0");
        else drawStroke(E, [[o.x, o.y], [o.x + o.w * 0.5, o.y + o.h], [o.x + o.w, o.y + o.h * 0.3]], 10 + Math.floor(o.h / 8), o.color);
    }
    E._render();
}

/** Wait until `done()` or a deadline, running the watchdog when the pool stops answering. */
async function until(done, t) {
    for (let k = 0; k < 4000; k++) {
        if (done()) return true;
        await later(3);
        if (k % 60 === 59 && t.silent) watchdog();
    }
    return done();
}

/**
 * The head's dispatch promotes a fill target to a shape before its job goes out (`_dispatchPair`), a
 * document change the progress count does not see: where the parallel engine's head is in flight,
 * the serial one makes the same promotion, which its own dispatch of that head then skips.
 */
function headPromotions(S, pState) {
    for (const [, arr] of JSON.parse(pState)) {
        for (const o of arr) {
            const x = JSON.parse(o);
            if (x.type !== "shape") continue;
            const rec = S.doc.getById(x.id);
            if (rec && rec.obj.type === "fill") S.doc.fillToShapeById(x.id);
        }
    }
}

/** One op. `par`: the parked gestures are waited for; the serial engine's barriers run inline. */
async function apply(E, op, par, t) {
    switch (op.k) {
    case "erase": eraseGesture(E, op.pts, op.size); break;
    case "bake":
        if (par) for (let k = 0; k < op.ticks; k++) { E._bakeTickInner(); t.flying = Math.max(t.flying || 0, [...E._cuts.values()].filter((c) => c.state === "flight").length); await later(4); }
        break;
    case "undo": E.undo(); break;
    case "redo": E.redo(); break;
    case "tap": click(E, op.at[0], op.at[1]); if (par) expect(await until(() => !E._barrier, t)).toBe(true); break;
    case "drag": {
        click(E, op.from[0], op.from[1]);
        if (par) expect(await until(() => !E._barrier, t)).toBe(true);
        E.pointerDown(op.from[0], op.from[1]);
        for (let k = 1; k <= 4; k++) E.pointerMove(op.from[0] + (op.by[0] * k) / 4, op.from[1] + (op.by[1] * k) / 4);
        E.pointerUp();
        if (par) expect(await until(() => !E._barrier && !E._pressWait, t)).toBe(true);
        E.deselect();
        break;
    }
    case "ink": drawStroke(E, op.pts, 12, "rgb(20,120,20)"); break;
    case "descend": descend(E, 1, op.at[0], op.at[1]); break;
    case "top": topView(E); break;
    default: throw new Error(op.k);
    }
}

async function runSeed(seed) {
    const { world, ops } = script(seed), rnd = lcg(seed * 31 + 7);
    // The parallel engine: three fake workers.
    resetEraseWorkerClient(); cores(8); setRasterWorkerCount(4);
    const t = fakePool(rnd);
    const P = mkEngine(800, 600), PL = new OpLog(P), pn = progress(P);
    build(P, world);
    PL.drain();
    const rec = [];
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    for (const op of ops) {
        const before = pn.n;
        await apply(P, op, true, t);
        rec.push({ op, before, after: pn.n, state: state(P) });
    }
    expect(await until(() => { if (P._eraseStrokes().length && !P._barrier) P._bakeTickInner(); return !P._eraseStrokes().length && !P._eraseBusy(); }, t)).toBe(true);
    const pool = eraseWorkerStats();
    const endP = { n: pn.n, state: state(P), steps: steps(P), log: PL.drain().entries.map((e) => [e.seq, JSON.stringify(e.op), e.touches]) };
    // The serial engine: no worker, everything inline, brought to the parallel one's position before each op.
    delete global.Worker;
    resetEraseWorkerClient();
    const S = mkEngine(800, 600), SL = new OpLog(S), sn = progress(S);
    build(S, world);
    SL.drain();
    const sync = (n) => { for (let g = 0; g < 10000 && sn.n < n; g++) if (!S._bakeNext()) break; };
    for (let i = 0; i < rec.length; i++) {
        const r = rec[i];
        sync(r.before);
        expect({ i, op: r.op.k, at: sn.n }).toEqual({ i, op: r.op.k, at: r.before });
        await apply(S, r.op, false, t);
        sync(r.after);
        expect({ i, op: r.op.k, at: sn.n }).toEqual({ i, op: r.op.k, at: r.after });
        headPromotions(S, r.state);
        if (process.env.FUZZ_DBG && state(S) !== r.state) {
            const ids = (st) => new Map(JSON.parse(st).flatMap(([k, arr]) => arr.map((o) => { const x = JSON.parse(o); return [x.id, k + " " + o.slice(0, 160)]; })));
            const a = ids(state(S)), b = ids(r.state);
            console.log("DIFF op " + i + " " + JSON.stringify(r.op) + "\nonly S: " + [...a].filter(([id, v]) => b.get(id) !== v).map(([, v]) => v).join("\n") + "\nonly P: " + [...b].filter(([id, v]) => a.get(id) !== v).map(([, v]) => v).join("\n"));
        }
        expect({ i, op: r.op.k, same: state(S) === r.state }).toEqual({ i, op: r.op.k, same: true });
    }
    sync(endP.n);
    expect(S._eraseStrokes()).toHaveLength(0);
    expect(state(S) === endP.state).toBe(true);
    expect(steps(S)).toEqual(endP.steps);
    expect(SL.drain().entries.map((e) => [e.seq, JSON.stringify(e.op), e.touches])).toEqual(endP.log);
    expect(P._eraseAborted).toEqual([]);
    expect(S._eraseAborted).toEqual([]);
    spy.mockRestore();
    return { ops: ops.length, applied: endP.n, flying: t.flying || 0, died: t.died, silent: t.silent, answered: t.answered, descentJobs: t.descentJobs, respawns: pool.respawns, broken: pool.broken,
        descents: ops.filter((o) => o.k === "descend").length, undos: ops.filter((o) => o.k === "undo").length };
}

afterEach(() => { delete global.Worker; resetEraseWorkerClient(); setRasterWorkerCount(null); cores(4); });

describe("parallel = serial under random op sequences, through the interim pool's failure modes", () => {
    const n = +(process.env.ERASE_FUZZ_SEEDS || 0);
    const seeds = n ? Array.from({ length: n }, (_, k) => 1000 + k) : [3, 7, 12, 21, 34, 55, 1016, 1037];   // 1016, 1037: a barrier round's promotions
    const totals = [];
    for (const seed of seeds) {
        test("seed " + seed, async () => { totals.push({ seed, ...(await runSeed(seed)) }); });
    }
    afterAll(() => { if (process.env.ERASE_FUZZ_LOG) console.log("FUZZ " + JSON.stringify(totals)); });
});
