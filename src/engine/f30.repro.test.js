/**
 * F30 — the async bake path, with the camera actually MOVING. DOES NOT REPRODUCE.
 *
 * Everything tried before ran `flushErases()`: the whole backlog drained in one
 * synchronous call with the camera standing still. BS-3 comes closest and
 * deliberately holds the camera fixed ("the camera is not moved here, only
 * marked busy"). So the one thing the reported session did that no test does —
 * cross a level boundary while an erase backlog is still pending, with
 * `_bakeTick` running in slices between camera events — has never been driven.
 *
 * The two arms run the SAME scripted gestures at the same camera positions. The
 * only difference is who drains the backlog: `flushErases()` on the spot, or the
 * app's own timer, whenever it can get a slice.
 *
 * RESULT (2026-08-26, post-lattice): the two arms agree, and every gesture with
 * ink under it cut. So the async path is not where the reported failure lives —
 * at least not for a single stroke in one frame chain. What this session does
 * NOT set up is the BRANCHING frame tree F27 was about (siblings minted by
 * visiting two distant regions), which is where a re-home has no chain to cede
 * along. Kept as a regression test: nothing else drives `_bakeTick` against a
 * camera that is actually moving.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, inkAt } from "./__testkit__/harness";

jest.setTimeout(300000);
useEngines();

const BLUE = "#1133cc";

/** A wheel/pinch stream WITH the app's bake timer firing between events. */
function zoomTicking(E, toLevel, tick, sx = 400, sy = 300) {
    let guard = 0;
    while (E.activeLevel < toLevel && guard++ < 4000) {
        E.zoomAt(sx, sy, -60);
        if (tick) E._bakeTick();       // deferred while `_camBusy()` — as in the app
    }
    return E.activeLevel;
}

/**
 * One scripted session. `sync` drains every mark before the camera moves again;
 * otherwise the marks are left to `_bakeTick`, which is what the app does.
 *
 * Returns one row per gesture: was there ink under the mark when it was made,
 * and did the gesture cut anything.
 */
function session(sync) {
    const E = mkEngine();
    drawStroke(E, [[100, 300], [700, 300]], 80, BLUE);
    E.setEraserSize(30);

    const drain = () => {
        if (sync) { E.flushErases(); return; }
        E._lastCamMove = null;                       // the user's hand comes off
        for (let i = 0; i < 800 && E._eraseStrokes().length; i++) E._bakeTick();
    };
    const rows = [];
    const swipe = (x, y0, y1, { pending = false } = {}) => {
        const had = inkAt(E, x, (y0 + y1) / 2);
        eraseGesture(E, [[x, y0], [x, y1]]);
        const id = E.journal[E.journal.length - 1].id;
        if (!pending) drain();
        rows.push({ id, level: E.activeLevel, had });
    };

    // Every swipe lands 120 px RIGHT of the zoom centre, and every zoom is
    // centred on (400, 300). So the centre is never cut, and the hole a swipe
    // leaves is carried off screen by the next zoom — each gesture meets fresh
    // ink. Get this wrong and the eraser is over blank paper, which is a
    // consumed mark for an entirely legitimate reason (see SC-4).
    const X = 520;
    for (let i = 0; i < 3; i++) swipe(200 + i * 50, 240, 360);        // three cuts at L0
    swipe(X, 240, 360, { pending: !sync });                           // left pending...
    zoomTicking(E, 1, !sync);                                         // ...across the crossing
    swipe(X, 240, 360);                                               // the cede at L1
    for (let i = 0; i < 7; i++) {                                     // deeper inside L1
        swipe(X, 250, 350, { pending: !sync });
        for (let k = 0; k < 30; k++) { E.zoomAt(400, 300, -60); if (!sync) E._bakeTick(); }
        drain();
    }
    swipe(X, 250, 350, { pending: !sync });
    zoomTicking(E, 2, !sync);                                         // the second crossing
    swipe(X, 240, 360);                                               // the one that did nothing
    E.flushErases();                                                 // both arms end settled

    const cut = new Map();
    for (const j of E.journal) if (j.kind === "erase") cut.set(j.id, (j.cuts || []).length);
    return rows.map((r) => ({ ...r, cuts: cut.has(r.id) ? cut.get(r.id) : "GONE" }));
}

describe("F30 — an eraser consumed without cutting anything", () => {
    test("a level crossing with a live backlog, driven through _bakeTick", () => {
        const dead = (rows) => rows.filter((r) => r.had && r.cuts === 0);
        const timed = session(false), flushed = session(true);
        // Both arms must have TEETH. A session where the eraser sat over blank
        // paper proves nothing, and that is the easy way to write this test by
        // accident — the first two drafts of it did exactly that, and so did
        // SC-4 until 2026-08-20.
        expect(timed.filter((r) => r.had).length).toBeGreaterThan(10);
        expect(flushed.filter((r) => r.had).length).toBeGreaterThan(10);
        // The control: draining on the spot cuts every mark that had ink under it.
        expect(dead(flushed)).toEqual([]);
        // ...and the app's own path had better do the same.
        expect(dead(timed)).toEqual([]);
    });
});
