/**
 * prefetch.js — what the pyramid fetches before the view needs it (A3 §4.3; PLAN §1.2), as priority-4 jobs in
 * this order: the near coarser levels ℓv − 1 and ℓv − 2 over the screen and a one-cell margin; the far levels —
 * the view zoomed out 4^k about its centre (k = 1 … 11), three octaves under that view's level, over 2.5 of its
 * screens, in the parent and grandparent frames once the level is coarser than the frame's own (ℓS < −8); the
 * crossing target near a crossing; the ring at ℓv only at rest. Nothing while a report is sending.
 *
 *   - Budget-gated: at most the plates the cache can hold beside what is pinned and already protected.
 *   - The near levels pack from the live table (they are inside the camera's window, A3 §4.2); the far levels and
 *     the crossing target read off camera through `stage.snapshot` within `cfg.prefetchReadMs`, and a job carries
 *     its table. A read past its budget is skipped this time; its tiles stay cached for the next.
 *   - Pure but for those reads: it posts nothing and changes no record; `farKeysOf(jobs)` is what the store protects.
 */
import { PLATE_PX, plateRange } from "./plate";
import { levelFor, ownFloor, zOf } from "./level";
import { levelCell, PLATE_BYTES, RANK } from "./PyramidStore";
import { cellOf } from "../frameLattice";
import { perfNow } from "../now";

/** Zoom-out steps of 4× the far levels cover: 22 octaves (Kobin's bacteria-to-ladybird gesture is 22.5, PP §10.3). */
export const FAR_STEPS = 11;
/** Octaves under each zoomed-out view the far level is taken at (the ladder's 12 quanta). */
export const FAR_OCTAVES = 3;
/** The far levels cover this many of their zoomed-out screens, so a wheel anchored at the screen's edge stays inside. */
export const FAR_MARGIN = 2.5;
/** Milliseconds of off-camera reads one plan may spend. */
export const PREFETCH_READ_MS = 8;

/**
 * @param {object} view the published view (`PicturePyramid`'s FC2 object)
 * @param {object} stage the Stage: `lm`, `snapshot(frameId, rect, budgetMs)`
 * @param {object} store the `PyramidStore`
 * @param {object} cfg `enter`, `exit`, `levelStep`; `atRest`, `reportBusy`, `focus` ([x, y] device px), `gens`, `prefetchReadMs`, `now`
 * @returns {object[]} typed jobs, priority 4
 */
export function prefetchPlan(view, stage, store, cfg = {}) {
    if (cfg.reportBusy || !view || view.frameId == null || !stage) return [];
    const lm = stage.lm, S = view.S, F = String(view.frameId), lv = view.level, floor = ownFloor(S);
    const wDev = Math.round(view.cssW * view.dpr), hDev = Math.round(view.cssH * view.dpr);
    const win = { left: -view.tx / view.k, top: -view.ty / view.k, right: (wDev - view.tx) / view.k, bottom: (hDev - view.ty) / view.k };
    const cx = (win.left + win.right) / 2, cy = (win.top + win.bottom) / 2;
    const gen = cfg.gens && cfg.gens.prefetch != null ? cfg.gens.prefetch : 0;
    let room = roomOf(store);
    const jobs = [];
    const take = (frame, l, rect, purpose, table, extra = null) => {
        if (room <= 0) return;
        const r = plateRange(rect, zOf(l, S)), cells = [];
        const keep = (i, j) => { const c = levelCell(frame, l, S, i, j); if (store.wants(c.key)) cells.push(c); };
        for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (!extra || !extra(i, j)) keep(i, j);
        if (!cells.length) return;
        const Z = zOf(l, S);
        const mid = [((rect.left + rect.right) / 2) * Z, ((rect.top + rect.bottom) / 2) * Z];
        jobs.push({ kind: "prefetch", prio: 4, frame, level: l, S, Z, cells: cells.slice(0, room), clips: null, purpose, gen,
            attention: mid, group: null, table: table || null });
        room -= Math.min(room, cells.length);
    };

    // 1. Near: ℓv − 1 and ℓv − 2 over the screen and a one-cell margin, from the live table.
    for (const d of [1, 2]) {
        const l = lv - d;
        if (l < floor) break;
        const m = PLATE_PX / zOf(l, S);
        take(F, l, { left: win.left - m, top: win.top - m, right: win.right + m, bottom: win.bottom + m }, "prefetch:near");
    }

    // 2. Far: the view zoomed out 4^k about its centre, three octaves under that view's level, over 2.5 of its screens.
    const now = cfg.now || perfNow, t0 = now(), budget = cfg.prefetchReadMs != null ? cfg.prefetchReadMs : PREFETCH_READ_MS;
    const hw = (win.right - win.left) / 2, hh = (win.bottom - win.top) / 2;
    const seen = new Set([F + "|" + (lv - 1), F + "|" + (lv - 2)]);
    for (let k = 1; k <= FAR_STEPS && room > 0; k++) {
        const Zk = view.Z / 4 ** k;
        let l = levelFor(Zk / 2 ** FAR_OCTAVES, S), frame = F;
        let rect = { left: cx - hw * 4 ** k * FAR_MARGIN, top: cy - hh * 4 ** k * FAR_MARGIN, right: cx + hw * 4 ** k * FAR_MARGIN, bottom: cy + hh * 4 ** k * FAR_MARGIN };
        while (l < floor) {
            const f = lm && lm.frame ? lm.frame(frame) : null;
            if (!f || f.parent == null) { l = null; break; }
            rect = lm.mapRectF(rect, frame, f.parent);
            if (!rect) { l = null; break; }
            frame = String(f.parent); l += 12 / S;
        }
        if (l == null) break;
        if (seen.has(frame + "|" + l)) continue;
        seen.add(frame + "|" + l);
        const left = budget - (now() - t0);
        if (left <= 0) break;
        const table = stage.snapshot(frame, rect, left);
        if (!table) continue;
        take(frame, l, rect, "prefetch:far", table);
    }

    // 3. The crossing target, by `_crossTarget`'s predicate: the parent's ℓv + 12/S − 1 over the screen and a screen of
    //    margin near the exit; the child's ℓv − 12/S + 1 at the focus near the entry. The equal picture is never fetched.
    const inScale = view.Z / view.dpr;
    const f = lm && lm.frame ? lm.frame(F) : null;
    if (f && cfg.exit != null && inScale < cfg.exit * 1.25 && f.parent != null && room > 0) {
        const grown = { left: win.left - 2 * hw, top: win.top - 2 * hh, right: win.right + 2 * hw, bottom: win.bottom + 2 * hh };
        const rect = lm.mapRectF(grown, F, f.parent);
        const left = budget - (now() - t0);
        const table = rect && left > 0 ? stage.snapshot(f.parent, rect, left) : null;
        if (table) take(String(f.parent), lv + 12 / S - 1, rect, "prefetch:cross", table);
    } else if (f && cfg.enter != null && inScale > cfg.enter * 0.8 && room > 0) {
        const a = cfg.focus || [wDev / 2, hDev / 2];
        const px = (a[0] - view.tx) / view.k, py = (a[1] - view.ty) / view.k;
        const cc = cellOf(px, py), child = lm.findCellChild ? lm.findCellChild(F, cc.i, cc.j) : null;
        const p = child ? lm.mapPointF([px, py], F, child.id) : null;
        const l = lv - 12 / S + 1;
        if (p && l >= floor) {
            const m = PLATE_PX / zOf(l, S);                                  // the focus's cell and its neighbours
            const rect = { left: p[0] - m, top: p[1] - m, right: p[0] + m, bottom: p[1] + m };
            const left = budget - (now() - t0);
            const table = left > 0 ? stage.snapshot(child.id, rect, left) : null;
            if (table) take(String(child.id), l, rect, "prefetch:cross", table);
        }
    }

    // 4. The ring at ℓv, only at rest and only with the room left.
    if (cfg.atRest && room > 0) {
        const r = plateRange(win, zOf(lv, S)), m = PLATE_PX / zOf(lv, S);
        take(F, lv, { left: win.left - m, top: win.top - m, right: win.right + m, bottom: win.bottom + m }, "prefetch:ring", null,
            (i, j) => i >= r.i0 && i <= r.i1 && j >= r.j0 && j <= r.j1);
    }
    return jobs;
}

/** The far levels' keys: the store's FAR protection class (`PicturePyramid.setFar`). */
export function farKeysOf(jobs) {
    const out = new Set();
    for (const j of jobs) if (j.purpose === "prefetch:far") for (const c of j.cells) out.add(c.key);
    return out;
}

/** Plates the cache can take beside what is pinned and what is already protected. */
function roomOf(store) {
    let used = 0;
    for (const r of store.records()) if (store.isPinned(r.key) || store.rankOf(r) >= RANK.FAR) used += r.bytes;
    return Math.max(0, Math.floor((store.maxBytes - store.heldBytes - used) / PLATE_BYTES));
}
