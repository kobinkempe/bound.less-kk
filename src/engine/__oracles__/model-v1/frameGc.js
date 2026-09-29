// Frozen copy of src/engine/frameGc.js at 5e9b1dd (model-v1 oracle, README.md); only imports rewritten.
/**
 * frameGc.js — a frame holds something (OPEN-FLAGS F94; Kobin, 2026-09-23: "if there ever is a
 * frame, it has stuff in it"). A frame with no natives, kids or shadows is forgotten, unless:
 *   - the camera is in it or above it, or left it within the last CAM_TRAIL frames — a crossing
 *     back composes the plates of the frame it left through the frame affine (PAPER-PLAN R5a);
 *   - an undo or redo op names it (`Document.namedFrames`): history puts things back there by id,
 *     and the frame goes once the op leaves history (the 200-op cap, a dead redo branch).
 * Candidates are the frames something may have emptied or minted — a native's old home, a moved
 * frame and its old parent, a detached list, every frame a gesture adds, the frames the camera left
 * and what dropped ops named — collected at a gesture's end and at a change of the camera's frame,
 * never mid-gesture, while merges are held, or while an erase job holds a lattice copy (F67).
 * A load adds none: the host sweeps every frame once the store's state is in (`sweepFrames`).
 * STORE: a forgotten frame held nothing, so the saver no longer lists it and replay counts it as
 * holding every entry (F98); the next write's header lattice lacks it, and the op log records it.
 */

import { opFrames } from "./Document";

/** Frame GC on or off; off forgets nothing. */
export const FRAME_GC_ENABLED = true;

/** Frames the camera left that stay while it may come back: their plates stand in on the way. */
export const CAM_TRAIL = 4;

/** The engine's state for this module, made once. */
export function initFrameGc(E) {
    E._gcCand = new Set();
    E._camTrail = [];
    E._gcCamAt = null;
    E._gcStats = { runs: 0, forgotten: 0 };
    E.lm.minted = E._gcCand;
    E.doc.onOpsDropped = (ops) => { for (const k of namedBy(E, ops)) E._gcCand.add(k); };
}

function namedBy(E, ops) {
    const out = new Set();
    for (const op of ops) opFrames(op, out);
    return out;
}

/** A document event: the frame it may have emptied becomes a candidate. */
export function noteFrameEvent(E, ev) {
    const c = E._gcCand;
    if (!c) return;
    if (ev.kind === "remove" && ev.level != null) c.add(String(ev.level));
    else if (ev.kind === "refile") { if (ev.frame != null) c.add(String(ev.frame)); if (ev.from && ev.from.parent != null) c.add(String(ev.from.parent)); }
    else if (ev.kind === "removeFrame" && ev.frame != null) c.add(String(ev.frame));
    else if (ev.kind === "reset") { E._gcCamAt = null; E._camTrail.length = 0; }   // a new document
}

/**
 * The camera's frame, once a render: a change moves the frame it left into the trail, and what falls
 * off the trail is a candidate. True when it changed (a trigger). The first frame after a load is
 * not a change.
 */
export function noteCameraFrame(E) {
    const at = E.cam.frame;
    if (!E._gcCand || E._gcCamAt === at) return false;
    const was = E._gcCamAt;
    E._gcCamAt = at;
    if (was == null) return false;
    const t = E._camTrail, k = t.indexOf(was);
    if (k >= 0) t.splice(k, 1);
    t.push(was);
    const here = t.indexOf(at);
    if (here >= 0) t.splice(here, 1);
    while (t.length > CAM_TRAIL) E._gcCand.add(t.shift());
    return true;
}

/**
 * Forget every candidate that holds nothing and that nothing keeps; a parent it empties follows.
 * `inRender`: called ahead of a render's list, which repaints the selection itself.
 */
export function collectFrames(E, inRender = false) {
    const cand = E._gcCand;
    if (!FRAME_GC_ENABLED) { if (cand) cand.clear(); return 0; }
    if (!cand || !cand.size) return 0;
    if (E._dragSel || E._drawing || E._lasso || E._descentOut || E.doc.holdMerges) return 0;   // the next trigger; a descent's lattice copy names frames
    const lm = E.lm, doc = E.doc;
    const keep = new Set(E._camTrail);
    for (let f = lm.frame(E.cam.frame); f; f = f.parent != null ? lm.frame(f.parent) : null) keep.add(f.id);
    const todo = [...cand];
    cand.clear();
    let named = null;
    const gone = [];
    while (todo.length) {
        const id = String(todo.pop());
        const f = lm.frame(id);
        if (!f || f.parent == null || keep.has(id)) continue;
        if (doc.count(id) || (f._kids && f._kids.size) || (f._shadows && f._shadows.size)) continue;
        if (!named) named = doc.namedFrames();
        if (named.has(id)) continue;
        const up = f.shadowOf != null ? f.shadowOf : f.parent;
        if (!lm.forget(id)) continue;
        doc.forgetFrame(id);
        if (E.store && E.store.forgetFrame) E.store.forgetFrame(id);   // its tiles: the id can be minted again (RENDER-1)
        if (E.stage) E.stage.forgetFrame(id);
        gone.push(id);
        todo.push(up);
    }
    if (gone.length && E.plates) { const g = new Set(gone); E.plates.dropFrames((G) => g.has(String(G))); }
    E._gcStats.runs++; E._gcStats.forgotten += gone.length;
    doc.noteForgotten(gone);
    const s = E.selection;
    if (gone.length && s && s.frames.some((fr) => !lm.frame(fr))) {
        const frames = s.frames.filter((fr) => lm.frame(fr));
        if (!inRender) E._setSelection(s.ids, frames);
        else if (s.ids.length || frames.length) E.selection = { ...s, frames };
        else E.selection = null;
    }
    return gone.length;
}

/** Every frame a candidate, then collected: the host's sweep once a restored store is in (F94). */
export function sweepFrames(E) {
    if (!E._gcCand) return 0;
    for (const id of E.lm.frames.keys()) E._gcCand.add(id);
    return collectFrames(E);
}
