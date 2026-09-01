/**
 * Scenes - the named views a drawing accumulates.
 *
 * A scene is a level plus a rectangle, and the point of auto-scenes is that the
 * user does not create them: ink added at a zoom the drawing has not visited
 * proposes one, and proposals that keep being drawn into get promoted. Jumping
 * to a scene is a camera move, never a document change.
 *
 * `docs/auto-scenes-design-bible.md` is the reasoning.
 *
 * Mixed into `KobinEngine.prototype` - see `mixin.js`. Split out of
 * `KobinEngine.js` on 2026-08-31.
 */
import {
    JOIN_WINDOWS,
    WINDOW_WIDTHS,
    computeSceneProposals,
    levelHash,
    matchScenes,
    resolveCapture,
    splitMembers,
} from "./scenes";
import { bboxOf } from "./geometry/derive";

class SceneOps {

    // ---- scenes (auto-scenes v2: docs/auto-scenes-design-bible.md) ----
    // Scenes speak FRAME KEYS (see scenes.js). Provide the transforms plus the
    // tree adjacency (depthOf / childrenOf) so clustering stitches across frame
    // edges — parent ← each child — instead of depth±1, and sibling frames (far
    // apart by construction) never merge.
    // Canonical scene key for the active frame: the depth int on the spine, the
    // frame id for a local sibling — matching scenes.js `normKey` so provisional
    // and captured scenes reconcile with computed proposals.
    _sceneKey() {
        const f = this.cam.frame;
        const d = this.lm.depthOf(f);
        return String(d) === f ? d : f;
    }
    _sceneProj() {
        return {
            mapRect: (rect, from, to) => this.lm.mapRectF(rect, from, to),
            widthFactor: (from, to) => this.lm.frameFactor(from, to),
            depthOf: (k) => { const d = this.lm.depthOf(k); return d == null ? Number(k) : d; },
            childrenOf: (k, keys) => { const f = this.lm.frameFor(k); const id = f && f.id; return id == null ? [] : keys.filter((x) => this.lm.parentOf(x) === id); },
        };
    }
    // Frame a rect (in `frameKey`'s coords) in the viewport. `frameKey` is a
    // frame id or a legacy depth int; it must exist in the frame tree. The
    // computed inScale may land outside [exit, enter]; _maybeCross normalizes it
    // through the ordinary crossing machinery.
    jumpTo(frameKey, rect) {
        if (!rect || !(rect.w > 0) || !(rect.h > 0)) return false;
        const f = this.lm.frameFor(frameKey);
        if (!f) return false; // unreachable frame / depth
        if (this._drawing) this.pointerUp();
        const s = Math.min(this.width / rect.w, this.height / rect.h);
        if (!(s > 0) || !Number.isFinite(s)) return false;
        this.cam.set({
            frame: f.id, activeLevel: f.depth, inScale: s,
            inPanX: (this.width - rect.w * s) / 2 - rect.x * s,
            inPanY: (this.height - rect.h * s) / 2 - rect.y * s,
        });
        this.cam._maybeCross();
        this.renderer.clear();
        this._render();
        this._queueIdleFits();
        return true;
    }
    // The real recompute — gated on per-level ink hashes, so it's free when
    // nothing changed since the last resolve (bible: evaluation schedule).
    refreshScenes() {
        const hashes = {};
        let changed = false;
        for (const Ls of Object.keys(this.doc.nativesByLevel)) {
            if (!(this.doc.nativesByLevel[Ls] || []).length) continue;
            hashes[Ls] = levelHash(this.doc.nativesByLevel, Ls);
            if (!this._levelHashes || this._levelHashes[Ls] !== hashes[Ls]) changed = true;
        }
        if (this._levelHashes) {
            for (const L of Object.keys(this._levelHashes)) if (!(L in hashes)) changed = true;
        }
        if (!changed && this._sceneMembers && !this._scenesProvisional) {
            return this.docMeta.scenes || [];
        }
        const proj = this._sceneProj();
        // Re-homed patches are NOT new ink. A deep erase moves part of an object
        // into frames that previously held nothing, and to the clustering that
        // looks exactly like someone drawing a fine detail there: it opens a
        // nested pocket, and the user's scene list grows every time they erase.
        // That is the storage becoming visible, which §3.4's rule of thumb
        // forbids. A patch fills a ceded TILE, which is 1/3000 of its parent's
        // own frame and sub-pixel there, so leaving it out cannot lose a
        // composition of any size the parent level can resolve.
        //
        // `attachRect` is what marks one. This used to test `srcId`, which the
        // cede refactor deleted — leaving the filter a silent no-op that let
        // every deep erase invent a scene again.
        const forScenes = {};
        for (const Ls of Object.keys(this.doc.nativesByLevel)) {
            forScenes[Ls] = (this.doc.nativesByLevel[Ls] || []).filter((o) => o.attachRect == null);
        }
        const proposals = computeSceneProposals(forScenes, proj);
        // Provisional scenes participate in matching so their ids/numbers
        // survive the resolve; unmatched (unpinned) ones drop naturally.
        const state = {
            scenes: this.docMeta.scenes || [],
            hidden: this.docMeta.hiddenScenes || [],
            seq: this.docMeta.sceneSeq || 1,
        };
        const merged = matchScenes(state, proposals, proj);
        for (const s of merged.scenes) delete s.provisional;
        this.docMeta = { ...this.docMeta, scenes: merged.scenes, hiddenScenes: merged.hidden, sceneSeq: merged.seq };
        this._sceneMembers = merged.members;
        this._levelHashes = hashes;
        this._scenesProvisional = false;
        return merged.scenes;
    }
    // Pen-up freshness: assign the new stroke to an existing scene at its
    // level or open a provisional one. No clustering runs here; the next
    // refreshScenes() (Scenes panel / Save) resolves everything properly.
    _noteInkAdded(o) {
        this._scenesProvisional = true;
        const F = this._sceneKey();
        const b = bboxOf(o);
        const w = o.lwFrame || 1e-9;
        const rect = { x: b.x0, y: b.y0, w: Math.max(b.x1 - b.x0, w), h: Math.max(b.y1 - b.y0, w) };
        const T = JOIN_WINDOWS * WINDOW_WIDTHS * w;
        for (const s of this.docMeta.scenes || []) {
            if (s.level !== F || s.captured) continue;
            const gx = Math.max(0, Math.max(s.rect.x - (rect.x + rect.w), rect.x - (s.rect.x + s.rect.w)));
            const gy = Math.max(0, Math.max(s.rect.y - (rect.y + rect.h), rect.y - (s.rect.y + s.rect.h)));
            if (gx <= T && gy <= T) {
                s.rect = {
                    x: Math.min(s.rect.x, rect.x), y: Math.min(s.rect.y, rect.y),
                    w: Math.max(s.rect.x + s.rect.w, rect.x + rect.w) - Math.min(s.rect.x, rect.x),
                    h: Math.max(s.rect.y + s.rect.h, rect.y + rect.h) - Math.min(s.rect.y, rect.y),
                };
                s.hash = ""; // thumbnail refresh at next resolve
                return;
            }
        }
        let seq = this.docMeta.sceneSeq || 1;
        const pad = 0.1 * Math.max(rect.w, rect.h);
        const s = {
            id: `s${seq}`, name: `Scene ${seq}`, level: F,
            rect: { x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad },
            pinned: false, auto: true, provisional: true, depth: 0,
        };
        seq += 1;
        this.docMeta = { ...this.docMeta, scenes: [...(this.docMeta.scenes || []), s], sceneSeq: seq };
    }
    renameScene(id, name) {
        const s = (this.docMeta.scenes || []).find((x) => x.id === id);
        if (!s || !name || !name.trim()) return false;
        s.name = name.trim().slice(0, 120);
        s.pinned = true; // a named scene never auto-drops
        delete s.provisional;
        return true;
    }
    // Deleting also suppresses the frame so the same cluster can't resurrect.
    deleteScene(id) {
        const scenes = this.docMeta.scenes || [];
        const s = scenes.find((x) => x.id === id);
        if (!s) return false;
        this.docMeta.scenes = scenes.filter((x) => x.id !== id);
        this.docMeta.hiddenScenes = [...(this.docMeta.hiddenScenes || []), { level: s.level, rect: s.rect }];
        return true;
    }
    // Split: half-gap re-cluster of the scene's members. Children are pinned
    // (they survive the next full-gap recompute) and the parent frame is
    // suppressed (it can't come back as a fresh scene).
    splitScene(id) {
        const scenes = this.docMeta.scenes || [];
        const s = scenes.find((x) => x.id === id);
        if (!s) return null;
        const ids = this._sceneMembers && this._sceneMembers[id];
        const memberObjs = ids && ids.length
            ? ids.map((i) => this.doc.getById(i)).filter(Boolean).map((r) => ({ o: r.obj, level: r.level }))
            : this.doc.queryRect(s.level, { left: s.rect.x, top: s.rect.y, right: s.rect.x + s.rect.w, bottom: s.rect.y + s.rect.h })
                .map((o) => ({ o, level: s.level }));
        const parts = splitMembers(memberObjs, s.level, this._sceneProj());
        if (!parts || parts.length < 2) return null;
        let seq = this.docMeta.sceneSeq || 1;
        const children = parts.map((p) => ({
            id: `s${seq}`, name: `Scene ${seq++}`,
            level: p.level, rect: p.rect, hash: p.hash,
            pinned: true, auto: true, depth: s.depth || 0,
        }));
        const idx = scenes.findIndex((x) => x.id === id);
        const next = scenes.slice();
        next.splice(idx, 1, ...children);
        this.docMeta = {
            ...this.docMeta,
            scenes: next,
            hiddenScenes: [...(this.docMeta.hiddenScenes || []), { level: s.level, rect: s.rect }],
            sceneSeq: seq,
        };
        if (this._sceneMembers) {
            delete this._sceneMembers[id];
            parts.forEach((p, i) => { this._sceneMembers[children[i].id] = p.memberIds; });
        }
        return children;
    }
    // The effective zoom a scene's frame is viewed at (for "at 240×" labels).
    sceneZoom(s) {
        const inScale = Math.min(this.width / s.rect.w, this.height / s.rect.h);
        return this.lm.effectiveZoom(s.level, inScale);
    }
    // Capture this view (bible §4): retarget the matching scene or create a
    // new pinned one. Captured frames are never auto-reframed by recomputes.
    captureView(name) {
        const win = this.cam.frameWindow(0);
        const view = {
            level: this._sceneKey(),
            rect: { x: win.left, y: win.top, w: win.right - win.left, h: win.bottom - win.top },
        };
        const target = resolveCapture(view, this.docMeta.scenes || [], this._sceneProj());
        if (target) {
            target.level = view.level;
            target.rect = view.rect;
            target.pinned = true;
            target.captured = true;
            target.hash = `cap${Date.now().toString(36)}`;
            delete target.provisional;
            if (name && name.trim()) target.name = name.trim().slice(0, 120);
            this.docMeta = { ...this.docMeta };
            return { scene: target, retargeted: true };
        }
        let seq = this.docMeta.sceneSeq || 1;
        const s = {
            id: `s${seq}`, name: (name && name.trim()) || `Scene ${seq}`,
            level: view.level, rect: view.rect,
            pinned: true, auto: false, captured: true, depth: 0,
            hash: `cap${Date.now().toString(36)}`,
        };
        seq += 1;
        this.docMeta = { ...this.docMeta, scenes: [...(this.docMeta.scenes || []), s], sceneSeq: seq };
        return { scene: s, retargeted: false };
    }
}

export const sceneOps = SceneOps.prototype;
