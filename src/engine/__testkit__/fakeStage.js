/**
 * fakeStage.js — the freshness half of the Stage (`src/engine/Stage.js`, B-SCENE-2's S2 interface) with no
 * document: `track`/`untrack`/`dirtySince`/`dirtyRects` and a bounded dirt log, behaving as the Stage's own
 * (`track` with an older `sinceG` looks the commits after it up in the log; `dirtyRects` is null once the log
 * no longer reaches `sinceG`). `commit(foot)` is one commit: `foot` maps a frame id to the rectangles (frame
 * units) it changed there. `snapshot` answers from a caller-set function, for the prefetch.
 *
 * NOT collected by jest (the directory is `__testkit__`); nothing in the app imports it.
 */

export const meets = (a, b) => !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);

/** @param {{logMax?: number}} [opts] the dirt log's length (the Stage keeps 2,048 commits) */
export function fakeStage({ logMax = 2048 } = {}) {
    const cells = new Map();          // key -> { key, frame, box, dirty }
    const log = [];                   // { G, foot: Map<frame, rect[]> }, oldest first
    let floor = 0;                    // the log holds every commit after this G
    const commitFns = new Set();
    const dirtIn = (F, sinceG, box) => {
        if (sinceG < floor) return st.generation;
        let g = 0;
        for (const e of log) {
            if (e.G <= sinceG || e.G <= g) continue;
            const rs = e.foot.get(F);
            if (rs && rs.some((r) => meets(r, box))) g = e.G;
        }
        return g;
    };
    const st = {
        generation: 0,
        stats: { tracked: 0, commits: 0 },
        cells,
        log,
        snapshotFn: null,
        track(key, frameId, box, sinceG) {
            const F = String(frameId);
            let c = cells.get(key);
            if (!c) { c = { key, frame: F, box, dirty: 0 }; cells.set(key, c); st.stats.tracked = cells.size; }
            if (sinceG != null && sinceG < st.generation) {
                const d = dirtIn(F, sinceG, box);
                if (d > c.dirty) c.dirty = d;
            }
        },
        untrack(key) { cells.delete(key); st.stats.tracked = cells.size; },
        dirtySince(key) { const c = cells.get(key); return c ? c.dirty : 0; },
        dirtyRects(frameId, sinceG, box = null) {
            if (sinceG < floor) return null;
            const F = String(frameId), out = [];
            for (const e of log) if (e.G > sinceG) { const rs = e.foot.get(F); if (rs) for (const r of rs) if (!box || meets(r, box)) out.push(r); }
            return out;
        },
        /** One commit: `foot` is `{ frameId: rect[] }` or a Map. Returns its G. */
        commit(foot) {
            const m = foot instanceof Map ? foot : new Map(Object.entries(foot).map(([F, rs]) => [String(F), rs]));
            const G = ++st.generation;
            log.push({ G, foot: m });
            while (log.length > logMax) floor = log.shift().G;
            const frames = new Set();
            for (const c of cells.values()) {
                const rs = m.get(c.frame);
                if (rs && rs.some((r) => meets(r, c.box))) { if (c.dirty < G) c.dirty = G; frames.add(c.frame); }
            }
            st.stats.commits++;
            for (const fn of commitFns) fn(G, { frames, drop: [], reset: false });
            return G;
        },
        onCommit(fn) { commitFns.add(fn); return () => commitFns.delete(fn); },
        snapshot(frameId, rect, budgetMs) {
            return st.snapshotFn ? st.snapshotFn(frameId, rect, budgetMs) : { frame: String(frameId), rect, generation: st.generation, items: () => [] };
        },
    };
    return st;
}
