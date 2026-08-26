/**
 * BS — the background bake stands aside for a live zoom.
 *
 * Reported 2026-08-20: "erase-then-zoom feels clunky... I imagine it's the
 * eraser baking." It was. `_bakeTick` already stood aside for drawing, erasing,
 * drag-select and panning — every way of holding the pointer down — but not for
 * ZOOMING, which is the one interaction that arrives as a stream of discrete
 * wheel/pinch events with no gesture-over signal. So an erase backlog and a
 * pinch competed for the same frames.
 *
 * Measured on the reported drawing before the fix: zooming with nothing to do
 * cost 4 ms; one erase-bake slice ran 621 ms against its 8 ms budget; zooming
 * during that backlog cost 484 ms at the median and 2,521 ms at worst.
 *
 * Quiet time is the only end-of-gesture marker available, so the bake waits
 * CAM_IDLE_MS after the last camera move — bounded by BAKE_STARVE_MS, because
 * someone who keeps zooming must still get their erase finished eventually.
 */
import { useEngines, mkEngine, drawStroke, eraseGesture, descend } from "./__testkit__/harness";

const perfNow = () => performance.now();

jest.setTimeout(300000);
useEngines();

/** An erase gesture left UNFLUSHED, so the bake backlog is real. */
function pendingErase(E) {
    drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
    drawStroke(E, [[150, 340], [650, 340]], 40, "#cc3311");
    drawStroke(E, [[150, 380], [650, 380]], 40, "#11cc33");
    E.setEraserSize(30);
    eraseGesture(E, [[400, 260], [400, 420]]);
    return E._eraseStrokes().length;
}

describe("BS-1 — a bake slice does not land on a frame the user is zooming", () => {
    test("a tick during a live zoom consumes nothing", () => {
        const E = mkEngine();
        const pending = pendingErase(E);
        expect(pending).toBeGreaterThan(0);

        E.zoomAt(400, 300, 10);          // the camera is now busy
        expect(E._camBusy()).toBe(true);

        const before = E._eraseStrokes().length;
        E._bakeTick();
        expect(E._eraseStrokes().length).toBe(before);   // backlog untouched
    });

    test("and once the camera goes quiet the bake gets on with it", () => {
        const E = mkEngine();
        pendingErase(E);
        E.zoomAt(400, 300, 10);

        // Pretend the wheel stopped long enough ago to count as quiet.
        E._lastCamMove = null;
        expect(E._camBusy()).toBe(false);
        for (let i = 0; i < 200 && E._eraseStrokes().length; i++) E._bakeTick();
        expect(E._eraseStrokes().length).toBe(0);
    });
});

describe("BS-2 — waiting for quiet is bounded: a continuous zoom cannot starve the bake", () => {
    test("a backlog held past the starve limit runs anyway", () => {
        const E = mkEngine();
        pendingErase(E);
        E.zoomAt(400, 300, 10);
        expect(E._camBusy()).toBe(true);

        // First tick defers and starts the hold clock.
        const before = E._eraseStrokes().length;
        E._bakeTick();
        expect(E._eraseStrokes().length).toBe(before);
        expect(E._bakeHeldSince).toBeTruthy();

        // Now the user keeps zooming, without pause, for a long time. Each turn
        // of this loop is "another stretch longer than the starve limit has
        // gone by" — the hold clock is reset every time a slice gets through,
        // so it has to be pushed back each turn, not once. The camera is STILL
        // busy throughout: that is the whole point of the case.
        for (let i = 0; i < 200 && E._eraseStrokes().length; i++) {
            E.zoomAt(400, 300, 10);      // still zooming, every single tick
            expect(E._camBusy()).toBe(true);
            if (E._bakeHeldSince) E._bakeHeldSince -= 5000;
            E._bakeTick();
        }
        expect(E._eraseStrokes().length).toBe(0);
    });
});

describe("BS-3 — the guard does not change what an erase produces", () => {
    test("same ink whether the camera was busy during the bake or not", () => {
        // The guard may change WHEN a slice runs, never WHAT it produces. Note
        // the camera is not moved here, only marked busy: `_objs()` is the
        // render list and genuinely depends on where the camera is, so zooming
        // one arm and not the other compares two different views and proves
        // nothing. The document is the thing that has to match.
        const shot = (busy) => {
            const E = mkEngine();
            drawStroke(E, [[150, 300], [650, 300]], 40, "#1133cc");
            descend(E, 2, 400, 300);
            E.setEraserSize(30);
            eraseGesture(E, [[400, 220], [400, 380]]);
            // `descend` zooms, so the camera is still warm from the setup —
            // the quiet arm has to say so explicitly, or it is not quiet and
            // both arms measure the same thing. (The first draft did exactly
            // that, and the "quiet" arm was the one that stalled.)
            E._lastCamMove = null;
            for (let i = 0; i < 400 && E._eraseStrokes().length; i++) {
                if (busy) {
                    E._lastCamMove = perfNow();               // a wheel event, without the wheel
                    expect(E._camBusy()).toBe(true);
                    E._bakeHeldSince = (E._bakeHeldSince || perfNow()) - 5000;
                }
                E._bakeTick();
            }
            expect(E._eraseStrokes().length).toBe(0);          // both arms finished
            return E.doc.levels().sort().map((k) => [k, E.doc.at(k)
                .map((o) => [o.id, o.type, o.color, Math.round((o.lwFrame || 0) * 1e6)])
                .sort((a, b) => a[0] - b[0])]);
        };
        expect(shot(true)).toEqual(shot(false));
    });
});
