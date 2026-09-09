/**
 * eraseDescent.js — the rehome descent as ONE JOB per family (Kobin, 2026-09-08: "invalidate
 * the whole object, wait till the worker sends the new object shapes back, then swap the
 * one object/family out for the new generated family").
 *
 * `descentJob(world, input)` runs the descent `erasePipeline._bakeRehomeInner` used to run
 * against the document, on a VIRTUAL document instead: the target is the only real object
 * it reads; everything a cede mints is virtual (negative ids) and lives only in the job.
 * Each level's square ink is derived here the way `TileStore._bakeUp` derives it — the same
 * `classifyUp`/`solidQuad`/`deriveStep` on the same numbers, for the one object — so the
 * kid a cede mints is the store's piece for the square, bit for bit (F42). Nothing is
 * applied until the whole descent has succeeded, so a refusal needs no unwinding (F47).
 * The result is a list of steps; `erasePipeline._applyDescent` mints the real objects in
 * the same order `Document.cedeTileById` did and records the steps on the gesture's op.
 *
 * `world` is `{ lm, cfg, width, opacityGroups }`: the engine's own on the main thread, a
 * LevelMap rebuilt from `lm.serialize()` in the worker. Same code, same bits. A test may
 * add `squareInk` to it to watch or fault the square ink the descent reads.
 */
import LevelMap from "./LevelMap";
import { R as CROSS_RATIO, W as FRAME_W, childTilePhase } from "./frameLattice";
import { classifyUp, deriveStep, solidQuad, seamPad, bboxOf } from "./geometry/derive";
import { loopsBBox, translateLoops, shapeComponents, dropDust, subtractShape, rectLoop } from "./geometry/arcShape";
import { shiftDown, cloneBelow } from "./geometry/offsets";
import { Loop } from "./geometry/loop";
import { cutJob, dustBarFor } from "./eraseJob";

const asLTRB = (r) => ("x0" in r ? { left: r.x0, top: r.y0, right: r.x1, bottom: r.y1 } : r);

/** The objects a descent reads and mints, apart from the document. */
export class VirtualDoc {
    constructor(seed) {
        this.map = new Map();
        this.next = -1;
        for (const rec of seed || []) this.map.set(rec.obj.id, { obj: rec.obj, level: String(rec.level) });
    }
    allocId() { return this.next--; }
    getById(id) { return this.map.get(id) || null; }
    add(obj, level) { this.map.set(obj.id, { obj, level: String(level) }); return obj; }
    removeById(id) { const rec = this.map.get(id); if (rec) this.map.delete(id); return rec || null; }
    editKey(o) { return o && o.editId != null ? o.editId : o && o.id; }
}

/**
 * The store's piece for object `id` in square (i, j) of frame F, derived from the level
 * above exactly as `TileStore._bakeUp` derives every parent object of that tile — for
 * this one object. `_squareInk`'s own filter follows: shape loops, or a covering fill's
 * clip as a rect loop.
 */
export function squareInkOf(world, vdoc, id, F, i, j) {
    const { lm, cfg, opacityGroups } = world;
    const cf = lm.frameFor(F);
    if (!cf) return null;
    F = cf.id;
    const frame = lm.frame(F);
    const parentId = frame && frame.parent;
    const rec = frame && frame.edge;
    if (!parentId || !rec) return null;
    const rect = lm.tileRect(F, i, j);
    const v = vdoc.getById(id);
    if (!v) return null;
    let o = v.obj;
    if (String(v.level) !== String(parentId)) {
        // A ring native (TileStore._ringNatives): homed in a cell around the parent, it
        // reaches this tile translated into the parent's coordinates, if its box meets
        // the tile's pre-image there at all.
        const pr = lm.rectToParent(rect, F);
        const inG = lm.mapRectF(pr, parentId, v.level);
        if (!inG) return null;
        const b = bboxOf(o, null);
        if (b.x1 < inG.left || b.x0 > inG.right || b.y1 < inG.top || b.y0 > inG.bottom) return null;
        const d = lm.projectF(o, v.level, parentId);
        if (!d) return null;
        d.origin = o.origin;
        o = d;
    }
    const tier = classifyUp(o, rec.s, rec.t, rect, cfg, null, null);
    if (tier === "empty") return null;
    const objs = [];
    if (tier === "solid") objs.push(solidQuad(o, rect, { pad: seamPad(o, cfg, opacityGroups) }));
    else {
        deriveStep([o], rec.s, rec.t, rect, F, {
            cfg, width: world.width, opacityGroups, live: null,
            parentCurved: (p) => p.origin === "native",
            childCurved: () => false,
        }, objs);
    }
    let loops = null, clip = null, tile = null;
    for (const p of objs) {
        if (p.id !== id) continue;
        if (p.type === "shape" && p.loops && p.loops.length) {
            loops = loops ? loops.concat(p.loops) : p.loops;
            clip = clip || p.clip; tile = tile || p.tile;
        } else if (p.type === "fill" && p.covers && p.clip) {
            const r = asLTRB(p.clip);
            loops = (loops || []).concat(rectLoop(r));
            clip = clip || p.clip;
        }
    }
    if (!loops || !loops.length || !clip) return null;
    return { loops, clip: asLTRB(clip), tile };
}

/**
 * `Document.cedeTileById` on the virtual document: the parent's hole cut exactly, the
 * remnants and the kids minted with virtual ids. Returns what the document's version
 * returns, plus the specs `_applyDescent` mints from.
 */
function cedeVirtual(vdoc, id, level, regions, holeInParent, attachRect, kidTile, kidBelow, boolOpts) {
    const rec = vdoc.getById(id);
    if (!rec) return null;
    const src = rec.obj;
    if (src.type !== "shape") return null;
    const R = { left: holeInParent.x0, top: holeInParent.y0, right: holeInParent.x1, bottom: holeInParent.y1 };
    const cut = subtractShape(src.loops, rectLoop(R), boolOpts).loops;
    const groups = dropDust(shapeComponents(cut), src.w);
    const removed = vdoc.removeById(id);
    if (!removed) return null;
    const z = src.z != null ? src.z : src.id;
    const editKey = vdoc.editKey(src);
    const mk = (loops, lvl, attach, tile, below) => {
        const obj = {
            type: "shape", origin: src.origin, id: vdoc.allocId(), z, loops,
            color: src.color, opacity: src.opacity, paths: [], editId: editKey,
        };
        if (src.w > 0) obj.w = src.w;
        if (attach) obj.attachRect = { ...attach };
        if (below) obj.below = below;
        if (tile) obj.tile = [tile[0], tile[1]];
        return { obj: vdoc.add(obj, lvl), level: String(lvl) };
    };
    const parents = groups.map((loops) => mk(loops, removed.level, src.attachRect, src.tile, cloneBelow(src.below)));
    const below1 = kidBelow !== undefined ? cloneBelow(kidBelow) : shiftDown(src.below, 1);
    const kids = regions.map((r) => mk(r.loops || r, level, attachRect, kidTile, cloneBelow(below1)));
    return { removed, parents, kids, pieces: parents.concat(kids) };
}

/**
 * The descent. `input` = `{ target: {obj, level}, E: {id, loops, w}, HE }`; the target's
 * object is read, never written. Returns `{ steps, stats }` — each step
 * `{ removedId, parents: [spec], kids: [spec] }` with `spec = { vid, level, obj }` — or
 * `{ refused: why, stats }`. `stats`: sealed booleans and dust, for the engine's tallies.
 * `minted`: the frames the descent added to (or re-parented in) the lattice it ran on,
 * for the engine's own lattice to merge (F67) — a kid can be homed a cell over from
 * any frame the engine has visited.
 */
export function descentJob(world, input) {
    const { lm } = world;
    const had = new Map();
    for (const f of lm.frames.values()) had.set(f.id, f.parent);
    const boolOpts = { freezeR: input.freezeR };
    const E = input.E, HE = input.HE;
    const o = input.target.obj, HO = String(input.target.level);
    const stats = { openChains: 0, dust: 0, seals: [] };
    const squareInk = world.squareInk || squareInkOf;
    const vdoc = new VirtualDoc([{ obj: o, level: HO }]);
    const path = lm.framePath(HO, HE);
    if (!path || path.up.length || !path.down.length) return { refused: "not a pure descent", stats };
    if (!E.loops || !E.loops.length) return { refused: "eraser has no perimeter", stats };
    const clipAtHE = E.loops;
    const eb = loopsBBox(clipAtHE);
    if (!eb) return { refused: "eraser has no bbox", stats };
    const rE = Math.max(eb.x1 - eb.x0, eb.y1 - eb.y0) / 2;
    const eraseAtHE = { left: eb.x0 - rE, top: eb.y0 - rE, right: eb.x1 + rE, bottom: eb.y1 + rE };
    if (o.type !== "shape") return { refused: "target is a " + o.type, stats };
    const steps = [];
    let why = null;
    let curIds = new Set([o.id]);
    let lastCeded = false;
    for (let k = 0; k < path.down.length && curIds.size; k++) {
        const F = path.down[k];
        const last = k === path.down.length - 1;
        const eraseAtF = lm.mapRectF(eraseAtHE, HE, F);
        if (!eraseAtF) { why = "the eraser maps to nothing in " + F; break; }
        const next = k + 1 < path.down.length ? lm.frame(path.down[k + 1]) : null;
        const cf = lm.frame(F);
        const kidIds = new Set();
        for (const cid0 of [...curIds]) {
            curIds.delete(cid0);
            let ids = [cid0];
            let only = false;
            const c0rec = vdoc.getById(cid0);
            const c0 = c0rec && c0rec.obj;
            const shift = c0 && c0.below ? lm.objShift(c0.below, c0rec.level, F) : null;
            if (c0 && c0.below && !shift) { why = "the picture's frame cannot be found in " + F; continue; }
            const F0 = shift ? shift.F0 : F;
            const rem = shift ? shift.rem : [0, 0];
            const kdep = c0rec ? lm.depthOf(F) - lm.depthOf(c0rec.level) : 1;
            const kidBelow = c0 && c0.below ? shiftDown(c0.below, kdep) : undefined;
            let need = { left: eraseAtF.left - rem[0], right: eraseAtF.right - rem[0],
                top: eraseAtF.top - rem[1], bottom: eraseAtF.bottom - rem[1] };
            if (next && next.centre) {
                const n0 = shift ? lm.objShift(c0.below, c0rec.level, next.id) : null;
                const nc = n0 && n0.F0 !== next.id ? lm.mapPointF([0, 0], n0.F0, F0) : [next.centre.x, next.centre.y];
                const h = FRAME_W / CROSS_RATIO / 2;   // half a cell, in F's units
                if (nc) {
                    need = {
                        left: Math.min(need.left, nc[0] - h), right: Math.max(need.right, nc[0] + h),
                        top: Math.min(need.top, nc[1] - h), bottom: Math.max(need.bottom, nc[1] + h),
                    };
                }
            }
            const rg = lm.tileRange(F0, need);
            const i1 = Math.min(rg.i1, rg.i0 + 1), j1 = Math.min(rg.j1, rg.j0 + 1);
            const ncx = (need.left + need.right) / 2, ncy = (need.top + need.bottom) / 2;
            const pref = lm.tileRange(F0, { left: ncx, right: ncx, top: ncy, bottom: ncy });
            const order = [[pref.i0, pref.j0]];
            for (let i = rg.i0; i <= i1; i++) for (let j = rg.j0; j <= j1; j++) if (i !== pref.i0 || j !== pref.j0) order.push([i, j]);
            const covers = (c, n = need) => c.left <= n.left && c.right >= n.right && c.top <= n.top && c.bottom >= n.bottom;
            for (const [i, j] of order) {
                if (only) break;
                const own0 = (i || j) ? lm.neighbour(F0, i, j) : null;
                const ownF = (i || j) ? lm.neighbour(F, i, j) : null;
                if ((i || j) && (!own0 || !ownF)) { why = "the square's frame cannot be found"; continue; }
                const F0n = own0 ? own0.id : F0, Fn = ownF ? ownF.id : F;
                const needIn = (i || j) ? { left: need.left - i * FRAME_W, right: need.right - i * FRAME_W, top: need.top - j * FRAME_W, bottom: need.bottom - j * FRAME_W } : need;
                for (const cid of [...ids]) {
                    const crec = vdoc.getById(cid);
                    if (!crec || crec.obj.type !== "shape") continue;
                    const cur = crec.obj;
                    const ink = squareInk(world, vdoc, cid, F0n, 0, 0);
                    if (!ink) { why = "tile holds none of its ink"; continue; }
                    if (i === pref.i0 && j === pref.j0 && covers(ink.clip, needIn)) only = true;
                    const groups = shapeComponents(ink.loops);
                    const solid = dropDust(groups, cur.w);
                    stats.dust += groups.length - solid.length;
                    if (!solid.length) { why = "the tile's ink is degenerate"; continue; }
                    let specs;
                    if (last) {
                        const whole = [].concat(...solid);
                        const tx = -rem[0] - i * FRAME_W, ty = -rem[1] - j * FRAME_W;
                        const clipHere = (tx || ty) ? translateLoops(clipAtHE, tx, ty) : clipAtHE;
                        const r = cutJob({ subject: whole, clip: clipHere, w: cur.w, dustBar: dustBarFor(E.bakePx), freezeR: boolOpts.freezeR, graze: "cede" });
                        if (r.stats && r.stats.openChains) stats.seals.push({ id: cur.id, open: r.stats.openChains, area: r.stats.sealedArea, weld: r.stats.weld, retriedAt: r.stats.retriedAt || 0 });
                        stats.dust += r.dust || 0;
                        if (r.kind === "grazed") { why = "grazing: nothing removed"; continue; }
                        specs = r.kind === "cut" ? r.regions.map((g) => ({ loops: g })) : [];
                        if (!specs.length) { why = "nothing survives the cut"; }
                    } else {
                        specs = solid.map((g) => ({ loops: g }));
                    }
                    const Rc = ink.clip;
                    const wParent = lm.mapRectF(Rc, F0n, crec.level);
                    if (!wParent || !(wParent.right > wParent.left) || !(wParent.bottom > wParent.top)) { why = "the tile maps to nothing in the parent"; continue; }
                    const pcur = cur.tile || [0, 0];
                    const cfo = ownF || cf;
                    const ph = ink.tile || (cfo && cfo.centre
                        ? [childTilePhase(pcur[0], cfo.centre.x, CROSS_RATIO), childTilePhase(pcur[1], cfo.centre.y, CROSS_RATIO)]
                        : [0, 0]);
                    const step = cedeVirtual(vdoc, cid, Fn, specs,
                        { x0: wParent.left, y0: wParent.top, x1: wParent.right, y1: wParent.bottom },
                        { x0: Rc.left, y0: Rc.top, x1: Rc.right, y1: Rc.bottom }, ph, kidBelow, boolOpts);
                    if (!step) { why = "cedeTileById refused"; continue; }
                    const spec = (p) => ({ vid: p.obj.id, level: p.level, obj: p.obj });
                    steps.push({ removedId: step.removed.obj.id, parents: step.parents.map(spec), kids: step.kids.map(spec) });
                    if (last) lastCeded = true;
                    ids = ids.filter((x) => x !== cid).concat(step.parents.map((p) => p.obj.id));
                    for (const kd of step.kids) kidIds.add(kd.obj.id);
                }
            }
        }
        curIds = kidIds;
    }
    if (!steps.length) return { refused: "no tile ceded: " + (why || "?"), stats };
    if (!lastCeded) return { refused: "last link refused: " + (why || "?"), stats };
    const minted = [];
    for (const f of lm.frames.values()) if (!had.has(f.id) || had.get(f.id) !== f.parent) minted.push({ id: f.id, parent: f.parent, depth: f.depth, i: f.cell.i, j: f.cell.j });
    return { steps, stats, minted };
}

// ---- across a thread ----

const own = (l) => { const x = Loop.from(l); return { buf: x.buf.slice(), idx: x.idx.slice() }; };
const wrap = (x) => new Loop(x.buf, x.idx);
const objOut = (o, transfer) => {
    const out = { ...o, paths: [] };
    delete out._bbox; delete out._home; delete out._ver; delete out._zScan;
    if (o.loops) { out.loops = o.loops.map(own); for (const x of out.loops) transfer.push(x.buf.buffer, x.idx.buffer); }
    return out;
};
const objIn = (o) => (o.loops ? { ...o, loops: o.loops.map(wrap) } : o);

/** A descent job as a message plus the buffers to transfer: the target and the eraser copied, the lattice as `lm.serialize()`. */
export function wireDescent(world, input) {
    const transfer = [];
    const msg = {
        lattice: world.lm.serialize(), width: world.width, height: world.lm.height, cfg: world.cfg, opacityGroups: world.opacityGroups,
        freezeR: input.freezeR, HE: input.HE,
        target: { level: String(input.target.level), obj: objOut(input.target.obj, transfer) },
        E: { id: input.E.id, w: input.E.w, bakePx: input.E.bakePx, loops: input.E.loops.map(own) },
    };
    for (const x of msg.E.loops) transfer.push(x.buf.buffer, x.idx.buffer);
    return { msg, transfer };
}
/** The world and the input back, in the worker: a LevelMap rebuilt from the lattice. */
export function unwireDescent(m) {
    const lm = new LevelMap(m.cfg, m.width, m.height);
    lm.load(m.lattice);
    const world = { lm, cfg: m.cfg, width: m.width, opacityGroups: m.opacityGroups };
    const input = { freezeR: m.freezeR, HE: m.HE, target: { level: m.target.level, obj: objIn(m.target.obj) }, E: { id: m.E.id, w: m.E.w, bakePx: m.E.bakePx, loops: m.E.loops.map(wrap) } };
    return { world, input };
}
export function wireDescentResult(r) {
    if (!r.steps) return { msg: r, transfer: [] };
    const transfer = [];
    const spec = (s) => ({ vid: s.vid, level: s.level, obj: objOut(s.obj, transfer) });
    return { msg: { stats: r.stats, minted: r.minted, steps: r.steps.map((st) => ({ removedId: st.removedId, parents: st.parents.map(spec), kids: st.kids.map(spec) })) }, transfer };
}
export function unwireDescentResult(m) {
    if (!m.steps) return m;
    const spec = (s) => ({ vid: s.vid, level: s.level, obj: objIn(s.obj) });
    return { stats: m.stats, minted: m.minted, steps: m.steps.map((st) => ({ removedId: st.removedId, parents: st.parents.map(spec), kids: st.kids.map(spec) })) };
}
