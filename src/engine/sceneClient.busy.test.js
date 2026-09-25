/**
 * The scene index waits out a pan or a zoom (REVIEWER-2 SC-1: its idle tick, forced after 1 s,
 * ran 4 ms prep slices in the middle of a continuous zoom — a user zooming right after opening the
 * Magnum Opus paid one every second through the 0.9–1.3 s restore).
 */
import { useEngines, mkEngine } from "./__testkit__/harness";

useEngines();

describe("SB — the scene index is busy while the camera is", () => {
    test("SB-1 a pan in progress and a camera step just now both hold the scene tick; a still camera does not", () => {
        const E = mkEngine();
        const C = E._sceneClient;
        expect(C).toBeTruthy();
        E._lastCamMove = -1e9; E._panLast = null;
        expect(C._busy()).toBe(false);
        E._panLast = [100, 100];
        expect(C._busy()).toBe(true);                    // red: a pan was not busy
        E._panLast = null;
        E._lastCamMove = (typeof performance !== "undefined" ? performance.now() : Date.now());
        expect(C._busy()).toBe(true);                    // red: a zoom step was not busy
    });
});
