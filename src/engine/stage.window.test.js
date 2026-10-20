/**
 * stage.window.test.js — a camera step inside its tile ranges rebuilds no key set, and one across a tile line leaves the
 * camera's table watching exactly what a rebuild at the new window watches (OPEN-FLAGS F150).
 */
import { useEngines, mkEngine, drawStroke } from "./__testkit__/harness";
import { W } from "./frameLattice";

useEngines();

/** A camera table with a reroute group: a stroke in a frame shifted by more than a cell. */
const shiftedSource = () => {
    const E = mkEngine(800, 600);
    E.lm.ensureSpine(2);
    E.cam.set({ activeLevel: 2, frame: "2", inScale: 1, inPanX: 400, inPanY: 300 });
    E._render();
    drawStroke(E, [[300, 300], [500, 320]], 10);
    E.doc.setFrameShift("2", [1.3 * W, 0]);
    E._render();
    return E;
};
const watched = (st) => ({
    win: [...st._winKeys].sort(),
    groups: [...st._groups.values()].map((g) => g.gk + ":" + [...g.keys].sort().join(" ")).sort(),
    keys: [...st._keys.keys()].sort(),
});
const moved = (w, dx) => ({ left: w.left + dx, top: w.top, right: w.right + dx, bottom: w.bottom });

test("a step inside the tile ranges builds no keys; one across a tile line watches what a rebuild watches", () => {
    const E = shiftedSource();
    const st = E.stage, F = st.frame, w0 = { ...st.window };
    expect(st._groups.size).toBeGreaterThan(0);
    const before = watched(st);
    const built = jest.spyOn(st, "_rangeKeys");
    st.sync(F, moved(w0, 3));
    expect(built).not.toHaveBeenCalled();                  // red before: the window's and every group's keys, every step
    expect(watched(st)).toEqual(before);
    const w1 = moved(w0, W / 2);                           // across the tile line at W / 2
    st.sync(F, w1);
    expect(built).toHaveBeenCalled();
    const stepped = watched(st);
    expect(stepped.win).not.toEqual(before.win);
    built.mockRestore();
    st._need = true;
    st.sync(F, w1);                                        // a rebuild at the same window
    expect(watched(st)).toEqual(stepped);
});
