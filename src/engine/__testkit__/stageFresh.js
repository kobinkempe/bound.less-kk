/**
 * stageFresh.js — the freshness fuzz of PLAN §3 row 1's Stage half (A2-scene.md §6.4), shared by
 * `stage.fresh.test.js` and `stage.fresh.probe.js`: a Document, LevelMap, TileStore, Stage and the
 * G-keyed PlateStore driven by seeded document changes, dispatches, out-of-order arrivals and
 * evictions, against an oracle that recomputes what each change touched from states it took itself.
 *
 * NOT collected by jest (the directory is `__testkit__`); nothing in the app imports it.
 */
import Document from "../Document";
import LevelMap from "../LevelMap";
import TileStore from "../TileStore";
import Stage from "../Stage";
import PlateStore from "../raster/PlateStore";
import { createPlacementModel } from "../placementModel";
import { rectLoop } from "../geometry/arcShape";
import { bboxOf } from "../geometry/derive";
import { snapDisplacement } from "../geometry/offsets";
import { plateKey, zqOf, PLATE_PX } from "../raster/plate";
import { BASE, ENTER, EXIT, W } from "../frameLattice";

const CFG = { enter: ENTER, base: BASE, exit: EXIT, scale: 1000, arcTolerancePx: 0.25, polygonizeWidthFrac: 1 / 3,
    cullPx: 0.3, fadeLoPx: 0.15, fatWidthPx: 4000, lineTolPx: 0.25 };
const QS = [-16, -8, 0, 8];                       // four plate levels: Zq 1/16 … 4

function lcg(seed) {
    let s = (seed >>> 0) & 0x7fffffff;
    return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const meets = (a, b) => !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);

/** One seeded run; returns what it counted. `fail(msg)` is called with each failure. */
export function runFresh(seed, steps, fail) {
    const rnd = lcg(seed * 7919 + 5);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const lm = new LevelMap(CFG, 800, 600);
    const doc = new Document();
    doc.lm = lm;
    doc.frameFactor = (a, b) => lm.frameFactor(a, b);
    const store = new TileStore(lm, doc, CFG);
    const stage = new Stage({ doc, lm, store, model: createPlacementModel({ doc, lm, store }), cfg: CFG });
    const plates = new PlateStore({ fresh: stage, maxBytes: 24, doc: null });
    // What the engine wires: a commit's plates to remove (a re-addressed frame's, another document's).
    stage.onCommit((G, info) => { if (info.reset) plates.dropAll(false); for (const p of info.drop) plates.dropFrames(p); });
    // The frames: the root, two children, a grandchild under the first (the one a re-address moves).
    lm.ensureSpine(0);
    const A = lm.cellChild("0", 3, -2).id, B = lm.cellChild("0", -5, 4).id, C = lm.cellChild(A, 100, 60).id;
    const FRAMES = ["0", A, B, C];
    const WATCH = ["0", A, C];                    // the frames plates are made for
    stage.sync("0", { left: -W, top: -W, right: W, bottom: W });
    // The oracle: per commit, the rects each watched frame saw change, computed from states it took itself.
    const oracle = [];
    /** A native as it stands: its home, table and box, and its box mapped into each watched frame now. */
    const stateOf = (id) => {
        const rec = doc.getById(id);
        if (!rec) return { key: "gone", rects: null };
        const b = bboxOf(rec.obj, null);
        const r = { left: b.x0, top: b.y0, right: b.x1, bottom: b.y1 };
        const rects = new Map();
        for (const F of WATCH) { const m = lm.mapRectObj(r, rec.level, F, rec.obj.below, rec.level, false); if (m) rects.set(F, m); }
        return { key: rec.level + "|" + JSON.stringify(rec.obj.below || null) + "|" + [r.left, r.top, r.right, r.bottom].join(","), rects };
    };
    const subtreeIds = (X) => {
        const ids = [];
        lm.walk(X, (f) => { for (const o of doc.list(f.id)) ids.push(o.id); });
        return ids;
    };
    let ids = [];
    const mk = (F) => {
        const x = ri(-30000, 30000), y = ri(-30000, 30000), s = ri(200, 9000);
        const o = { type: "shape", origin: "native", id: doc.allocId(), color: "#123", opacity: 1, w: 3,
            loops: rectLoop({ left: x, top: y, right: x + s, bottom: y + s * 0.6 }) };
        if (rnd() < 0.2) o.editId = ids.length ? pick(ids) : o.id;
        return o;
    };
    // One document change; returns the ids it touched (the oracle takes their states either side).
    const ops = [
        () => { const o = mk(pick(FRAMES)); doc.add(o, pick(FRAMES)); ids.push(o.id); return { after: [o.id] }; },
        () => { if (!ids.length) return null; const id = pick(ids); return { before: [id], run: () => { doc.removeById(id); ids = ids.filter((x) => x !== id); } }; },
        () => {
            if (!ids.length) return null;
            const id = pick(ids), below = [];
            for (let k = 0; k < 3; k++) if (rnd() < 0.5) below[k] = [snapDisplacement((rnd() - 0.5) * W * 0.8), snapDisplacement((rnd() - 0.5) * W * 0.8)];
            return { before: [id], after: [id], run: () => doc.setOffsetsById(id, below.length ? below : undefined) };
        },
        () => { if (!ids.length) return null; const id = pick(ids); return { before: [id], after: [id], run: () => doc.rehomeById(id, pick(FRAMES)) }; },
        () => {
            if (!ids.length) return null;
            const id = pick(ids), rec = doc.getById(id);
            if (!rec) return null;
            const g = Document.translateGeometry(Document.snapGeometry(rec.obj), ri(-4000, 4000), ri(-4000, 4000));
            return { before: [id], after: [id], run: () => doc.setGeometryById(id, g) };
        },
        () => {
            // A frame re-addressed: everything under it moved.
            const f = lm.frame(C), to = { parent: A, i: ri(-300, 300), j: ri(-300, 300) };
            const from = { parent: f.parent, i: f.cell.i, j: f.cell.j };
            const under = subtreeIds(C);
            return { before: under, after: under, run: () => { if (lm.readdress(C, to.parent, to.i, to.j) && lm.frame(C).parent === to.parent) doc.noteRefile(C, from, to); } };
        },
    ];
    // One change inside a commit: a native's state is taken the first time the commit names it and
    // again at the commit's end — a state that lived only inside one commit no plate can show.
    const doOne = (seen) => {
        const op = pick(ops)();
        if (!op) return;
        for (const id of [...(op.before || []), ...(op.after || [])]) if (!seen.has(id)) seen.set(id, stateOf(id));
        if (op.run) op.run();
    };
    /** What a commit touched: every native whose state at its end differs from its state at first sight, both states. */
    const touchedBy = (seen) => {
        const out = new Map(WATCH.map((F) => [F, []]));
        for (const [id, was] of seen) {
            const now = stateOf(id);
            if (now.key === was.key && now.key !== "gone") continue;
            for (const st of [was, now]) if (st.rects) for (const [F, m] of st.rects) out.get(F).push(m);
        }
        return out;
    };
    // The fake pool.
    const queue = [];
    let jobSeq = 0;
    const history = new Map();                    // key -> the G of every plate it ever stored
    const counts = { commits: 0, dispatches: 0, arrivals: 0, stored: 0, checks: 0, exactChecked: 0, overDirty: 0, evictions: 0, refused: 0 };
    const cellBox = (F, q, i, j) => {
        const u = PLATE_PX / zqOf(q), p = 1 / zqOf(q);
        return { left: i * u - p, top: j * u - p, right: (i + 1) * u + p, bottom: (j + 1) * u + p };
    };
    for (let step = 0; step < steps; step++) {
        const r = rnd();
        if (r < 0.35) {
            const G0 = stage.generation;
            const seen = new Map();
            if (rnd() < 0.25) stage.batch(() => { for (let k = ri(2, 5); k > 0; k--) doOne(seen); });
            else doOne(seen);
            if (stage.generation !== G0) { oracle.push({ G: stage.generation, rects: touchedBy(seen) }); counts.commits++; }
            if (lm.frame(C) && stage.frame) stage.sync(stage.frame, stage.window);
        } else if (r < 0.65) {
            const F = pick(WATCH), q = pick(QS), u = PLATE_PX / zqOf(q);
            // A cell near some ink, or anywhere in the frame.
            let i = ri(-3, 3), j = ri(-3, 3);
            if (ids.length && rnd() < 0.7) {
                const rec = doc.getById(pick(ids));
                const b = rec ? lm.mapRectObj((() => { const bb = bboxOf(rec.obj, null); return { left: bb.x0, top: bb.y0, right: bb.x1, bottom: bb.y1 }; })(), rec.level, F, rec.obj.below, rec.level, false) : null;
                if (b && isFinite(b.left) && Math.abs(b.left / u) < 1e6) { i = Math.floor(b.left / u); j = Math.floor(b.top / u); }
            }
            const key = plateKey(F, q, i, j);
            if (plates.inflight.has(key)) continue;
            const jobId = ++jobSeq, G = stage.generation;
            plates.beginJob(jobId, { frameId: F, q, Zq: zqOf(q) }, [{ i, j }], G);
            queue.push({ jobId, key, F, q, i, j, G });
            counts.dispatches++;
        } else if (r < 0.9 && queue.length) {
            const job = queue.splice(Math.floor(rnd() * queue.length), 1)[0];
            const cur = plates.get(job.key);
            const curG = cur ? cur.G : null;
            const refused = plates.inflight.get(job.key) && plates.inflight.get(job.key).refused;
            const st = plates.put({ key: job.key, frameId: job.F, q: job.q, Zq: zqOf(job.q), i: job.i, j: job.j, G: job.G, jobId: job.jobId, bytes: 1 });
            plates.endJob(job.jobId);
            counts.arrivals++;
            if (refused) counts.refused++;
            const now = plates.get(job.key);
            // (c) F106: a newer result replaced the stored plate; an older or equal one did not.
            if (!refused && curG != null && job.G > curG && (!now || now.G !== job.G)) fail("step " + step + ": a newer result (G " + job.G + ") did not replace G " + curG);
            if (curG != null && job.G <= curG && now && now.G !== curG) fail("step " + step + ": an older result replaced a newer plate");
            if (st !== "stale" && now && now.G === job.G) {
                counts.stored++;
                const h = history.get(job.key) || [];
                h.push(job.G);
                history.set(job.key, h);
            }
        } else {
            // An eviction: a plate dropped by the byte cap (evict everything past a small budget).
            const before = plates.size();
            plates.maxBytes = ri(4, 24);
            plates._evict();
            counts.evictions += before - plates.size();
            plates.maxBytes = 24;
        }
        // (a) monotone, per key, over what it stored.
        for (const [key, h] of history) for (let k = 1; k < h.length; k++) if (h[k] < h[k - 1]) fail("key " + key + ": G went down " + h[k - 1] + " → " + h[k]);
        // (b) a plate a later change touched is never exact.
        for (const e of plates.cache.values()) {
            counts.checks++;
            const box = cellBox(e.frameId, e.q, e.i, e.j);
            let touched = false;
            for (const c of oracle) {
                if (c.G <= e.G) continue;
                const rs = c.rects.get(String(e.frameId));
                if (rs && rs.some((x) => meets(x, box))) { touched = true; break; }
            }
            const exact = plates.isExact(e);
            if (exact) counts.exactChecked++;
            if (touched && exact) fail("step " + step + ": plate " + e.key + " at G " + e.G + " is exact but a later change touched it (dirtySince " + stage.dirtySince(e.key) + ")");
            if (!touched && !exact) counts.overDirty++;
        }
    }
    stage.destroy(); store.destroy(); plates.destroy();
    return counts;
}

