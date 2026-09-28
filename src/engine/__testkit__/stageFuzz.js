/**
 * stageFuzz.js — the scene's equivalence fuzz (A2-scene.md §2.14, PLAN §3 row 2): seeded random
 * operations on a jsdom engine, and after every one the Stage's items against `listFor`'s over the
 * same window, grouped by (z, id) and compared as multisets, plus PLAN §3's "no read changes the
 * document" over the same states. Shared by `stage.equiv.test.js` (5 × 40) and
 * `stage.equiv.probe.js` (60 × 80).
 *
 * NOT collected by jest (the directory is `__testkit__`); nothing in the app imports it.
 */
import { mkEngine, drawStroke, eraseGesture, descend, ascend } from "./harness";
import { OpLog } from "../oplog";
import { encodeObjects, decodeObjects } from "../format2";
import { collectFrames } from "../frameGc";

const COLOURS = ["rgb(0,0,0)", "rgb(200,30,30)", "rgb(30,120,200)", "rgb(40,160,60)"];

/** A 31-bit LCG: the same numbers on every platform. */
function lcg(seed) {
    let s = (seed >>> 0) & 0x7fffffff;
    return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** The document's identity, as the no-read-mutates property reads it. */
export function docState(E) {
    return [E.doc.rev, E.doc.offRev, E.lm.addrEpoch, E.lm.frames.size, [...E.lm.frames.keys()].join(",")].join("|");
}

/** A render-list entry or a Stage item as `(zKey, id | kind, piece, off, fam, erase)`. */
function rowOf(E, o, stageItem) {
    const piece = stageItem ? o.piece : o;
    const rec = E.doc.getById(o.id);
    const off = stageItem ? o.off : (o.res || [0, 0]);
    const fam = rec && rec.obj.editId != null ? rec.obj.editId : o.id;
    const z = stageItem ? o.zk : (o.z != null ? o.z : o.id);
    return { z, id: o.id, type: piece.type, piece, ox: off[0], oy: off[1], fam, erase: !!(stageItem ? o.erase : o.erase) };
}

/**
 * The first difference between the Stage's table and `listFor` over the Stage's window, or null.
 * The Stage is synced first when the camera left its frame or its window is not covered (a step
 * with no render); `synced` says so.
 */
export function compareStage(E) {
    const S = E.stage;
    let synced = false;
    if (S.frame !== String(E.cam.frame) || !S.window || !S.covers(S.frame, S.window)) {
        S.sync(E.cam.frame, S.frame === String(E.cam.frame) && S.window ? S.window : E._listWin(), Infinity);
        synced = true;
    }
    // listFor first: a tile it had to bake for a key the Stage watches means the Stage held it stale.
    const watched = new Set(S._keys.keys());
    const stale = [];
    const unsub = E.store.onTile((ev) => { if (ev.kind === "bake" && watched.has(ev.key) && S._keys.get(ev.key) && S._keys.get(ev.key).tile) stale.push(ev.key); });
    let B;
    try { B = E.listFor(S.frame, S.window, false, 0) || []; } finally { unsub(); }
    const A = S.items();
    if (stale.length) return { synced, diff: "a watched tile was stale: " + stale.slice(0, 3).join(" ") };
    const key = (r) => r.z + "|" + r.id;
    const group = (rows) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
    const ga = group(A.map((o) => rowOf(E, o, true))), gb = group(B.map((o) => rowOf(E, o, false)));
    for (const [k, rb] of gb) {
        const ra = ga.get(k);
        if (!ra) return { synced, diff: "missing in the Stage: " + k + " (" + rb.length + " pieces, " + rb[0].type + ")" };
        if (ra.length !== rb.length) return { synced, diff: "piece count " + k + ": stage " + ra.length + " listFor " + rb.length };
        const byPiece = new Map(ra.map((r) => [r.piece, r]));
        for (const r of rb) {
            const a = byPiece.get(r.piece);
            if (!a) return { synced, diff: "a piece of " + k + " differs (" + r.type + ")" };
            if (a.ox !== r.ox || a.oy !== r.oy) return { synced, diff: "offset of " + k + ": stage [" + a.ox + "," + a.oy + "] listFor [" + r.ox + "," + r.oy + "]" };
            if (a.fam !== r.fam || a.erase !== r.erase || a.type !== r.type) return { synced, diff: "fields of " + k };
        }
    }
    for (const k of ga.keys()) if (!gb.has(k)) return { synced, diff: "extra in the Stage: " + k + " (" + ga.get(k)[0].type + ")" };
    // Paint order across natives: the Stage's items are sorted (z, id).
    for (let i = 1; i < A.length; i++) {
        const a = A[i - 1], b = A[i];
        if (a.zk > b.zk || (a.zk === b.zk && a.id > b.id)) return { synced, diff: "order at " + i };
    }
    return { synced, diff: null };
}

/**
 * Reads that must not change the document: the Stage's own, after a sync. Returns the first read
 * that moved `docState`, or null. `others` counts, per kind, the reads that did move it today
 * (`listFor` of a frame, a lasso, a snapshot: A1 C1 makes them 0).
 */
export function pureReads(E, rnd, others) {
    const S = E.stage, F = S.frame, win = S.window;
    const s0 = docState(E);
    const items = S.items();
    for (const it of items) S.placed(it);
    for (const _ of S.itemsTopDown()) { /* walk */ }
    S.covers(F, win);
    S.changesSince(S.generation - 1);
    let n = 0;
    for (const it of items) {
        if (!it.nat || n++ > 12) continue;
        const pl = S.placeNative(it.nat, F);
        pl.box();
        pl.toStored([(win.left + win.right) / 2, (win.top + win.bottom) / 2]);
        pl.fromStored([0, 0]);
    }
    const sx = rnd() * E.width, sy = rnd() * E.height;
    E._hitTest(sx, sy);
    if (docState(E) !== s0) return "a Stage read or the hit test";
    const note = (kind, fn) => { const a = docState(E); fn(); if (docState(E) !== a) others[kind] = (others[kind] || 0) + 1; };
    note("listFor", () => E.listFor(F, win, false, 0));
    note("snapshot", () => S.snapshot(F, win, Infinity));
    note("lasso", () => E._lassoFind([[sx - 60, sy - 60], [sx + 60, sy - 60], [sx + 60, sy + 60], [sx - 60, sy + 60]]));
    return null;
}

/** A frame point of an item's ink, as the camera sees it, or null off screen. */
function inkPoint(E, it) {
    const p = it.piece;
    let q = null;
    if (p.loops && p.loops.length) { const l = p.loops[0]; const pc = l.at ? l.at(0) : l[0]; q = pc && (pc.A || pc); }
    else if (p.polys && p.polys.length && p.polys[0].length) q = p.polys[0][0];
    else if (p.pts && p.pts.length) q = p.pts[0];
    if (!q) return null;
    const x = (q[0] + it.off[0]) * E.cam.inScale + E.cam.inPanX, y = (q[1] + it.off[1]) * E.cam.inScale + E.cam.inPanY;
    return x > 2 && y > 2 && x < E.width - 2 && y < E.height - 2 ? [x, y] : null;
}

function snapshotOf(E, log) {
    const frames = {}, frameSeq = {};
    for (const level of Object.keys(E.doc.nativesByLevel)) { frames[level] = encodeObjects(E.doc.at(level)); frameSeq[level] = log.seq; }
    return { frames, frameSeq, crossings: E.lm.serialize(), camera: E.cam.state() };
}

/**
 * One seeded run: `steps` operations, `check(E, step, op)` after each. Returns the ops taken.
 * The engine is replaced by a reload (kobin-1 or the op log); `onEngine` sees each one.
 */
export function runStageFuzz(seed, steps, check, { w = 800, h = 600 } = {}) {
    const rnd = lcg(seed * 7919 + 17);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    let E = mkEngine(w, h);
    let log = new OpLog(E);
    let snap = null, entries = [];
    const ops = [];
    const inkItems = () => E.stage.items().filter((it) => !it.erase && it.nat && inkPoint(E, it));
    const strokePts = () => {
        const n = ri(2, 7), x0 = ri(60, w - 60), y0 = ri(60, h - 60), out = [[x0, y0]];
        for (let k = 1; k < n; k++) out.push([Math.min(w - 20, Math.max(20, out[k - 1][0] + ri(-160, 160))), Math.min(h - 20, Math.max(20, out[k - 1][1] + ri(-120, 120)))]);
        return out;
    };
    const table = [
        ["stroke", 6, () => {
            E.setOpacity(rnd() < 0.2 ? 0.5 : 1);
            drawStroke(E, strokePts(), ri(3, 40), pick(COLOURS), { raw: rnd() < 0.2 });
        }],
        ["erase", 3, () => {
            eraseGesture(E, strokePts(), ri(6, 40));
            const r = rnd();
            if (r < 0.45) E.flushErases();
            else if (r < 0.8) for (let k = ri(1, 4); k > 0; k--) E._bakeTick();
        }],
        ["tapDrag", 2, () => {
            const it = inkItems();
            if (!it.length) return;
            const p = inkPoint(E, pick(it));
            E.setTool("select");
            E.pointerDown(p[0], p[1]); E.pointerUp();
            E.pointerDown(p[0], p[1]);
            const dx = ri(-300, 300), dy = ri(-200, 200), n = ri(2, 6);
            for (let k = 1; k <= n; k++) E.pointerMove(p[0] + (dx * k) / n, p[1] + (dy * k) / n);
            E.pointerUp();
        }],
        ["lassoDrag", 1, () => {
            const x0 = ri(0, w / 2), y0 = ri(0, h / 2), x1 = x0 + ri(80, w / 2), y1 = y0 + ri(80, h / 2);
            E.setTool("select");
            E.pointerDown(x0, y0, true);
            for (const [x, y] of [[x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]]) E.pointerMove(x, y);
            E.pointerUp();
            const sel = E.selection;
            if (!sel || rnd() < 0.3) return;
            const it = E.stage.items().filter((i) => sel.ids.includes(i.id) && inkPoint(E, i));
            if (!it.length) return;
            const p = inkPoint(E, pick(it));
            E.pointerDown(p[0], p[1]);
            const dx = ri(-250, 250), dy = ri(-200, 200);
            E.pointerMove(p[0] + dx / 2, p[1] + dy / 2); E.pointerMove(p[0] + dx, p[1] + dy);
            E.pointerUp();
        }],
        ["subtreeDrag", 1, () => {
            const kids = [...E.lm.frames.values()].filter((f) => f.parent === E.cam.frame && E.doc.count(f.id));
            if (!kids.length) return;
            const f = pick(kids);
            E._setSelection([], [f.id]);
            const p = E._levelPointToScreen(f.id, 0, 0);
            E.setTool("select");
            E.pointerDown(p[0], p[1]);
            const dx = ri(-200, 200), dy = ri(-150, 150);
            E.pointerMove(p[0] + dx / 2, p[1] + dy / 2); E.pointerMove(p[0] + dx, p[1] + dy);
            E.pointerUp();
        }],
        ["delete", 1, () => { if (E.selection) E.deleteSelection(); }],
        ["undo", 3, () => { for (let k = ri(1, 4); k > 0; k--) E.undo(); }],
        ["redo", 2, () => { for (let k = ri(1, 3); k > 0; k--) E.redo(); }],
        ["zoom", 3, () => {
            // One to three crossings, about ink when there is some, between depths -1 and 4.
            const L = E.activeLevel;
            let to = ri(-1, 4);
            if (to === L) to = L + (L < 4 ? 1 : -1);
            to = Math.max(L - 3, Math.min(L + 3, to));
            const it = inkItems(), p = it.length && rnd() < 0.7 ? inkPoint(E, pick(it)) : [ri(100, w - 100), ri(100, h - 100)];
            if (to > L) descend(E, to, p[0], p[1]); else ascend(E, to, p[0], p[1]);
        }],
        ["zoomIn", 1, () => {
            const it = inkItems(), p = it.length ? inkPoint(E, pick(it)) : [ri(100, w - 100), ri(100, h - 100)];
            for (let k = ri(1, 6); k > 0; k--) E.zoomAt(p[0], p[1], rnd() < 0.5 ? -600 : 600);
        }],
        ["pan", 2, () => { for (let k = ri(1, 4); k > 0; k--) E.panBy(ri(-400, 400), ri(-300, 300)); }],
        ["reload1", 0.5, () => {
            const d = E.serializeDrawing();
            E.destroy();
            E = mkEngine(w, h);
            E.loadDrawing(d);
            E.flushBakes();
            log = new OpLog(E); snap = null; entries = [];
        }],
        ["reload2", 0.5, () => {
            if (!snap) { snap = snapshotOf(E, log); entries = log.drain().entries; return; }
            entries = entries.concat(log.drain().entries);
            const F = mkEngine(w, h);
            const nat = {};
            for (const level of Object.keys(snap.frames)) nat[level] = decodeObjects(snap.frames[level].objects, snap.frames[level].geo);
            F.loadDrawing({ format: "boundless-drawing", version: 2, meta: { name: "t" }, camera: snap.camera, crossings: E.lm.serialize(), natives: nat });
            const L = new OpLog(F);
            L.replay(entries, snap.frameSeq);
            F.flushBakes();
            F._render();
            E.destroy();
            E = F; log = L; snap = null; entries = [];
        }],
        ["gc", 0.5, () => { E.sweepFrames(); collectFrames(E); E._render(); }],
    ];
    const total = table.reduce((s, t) => s + t[1], 0);
    for (let step = 0; step < steps; step++) {
        let r = rnd() * total, op = table[0];
        for (const t of table) { if ((r -= t[1]) < 0) { op = t; break; } }
        op[2]();
        ops.push(op[0]);
        check(E, step, op[0], rnd);
    }
    return { ops, engine: E };
}
