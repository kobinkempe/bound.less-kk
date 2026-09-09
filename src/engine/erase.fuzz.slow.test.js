/**
 * EF — randomized erasing, checking the one invariant everything rests on:
 * every loop the boolean produces CLOSES.
 *
 * An unclosed chain is the worst failure this geometry has. It is painted shut
 * with a straight line across the object, its winding stops meaning anything,
 * and the file format refuses the whole drawing rather than store it. One
 * reached Kobin's document (871 pieces in 68 open chains) and is why the
 * boolean's tolerances are now scaled off the SUBJECT and why `_boolOk` refuses
 * a result that did not close.
 *
 * Seeds are deterministic so a failure can be replayed by number.
 */
import { useEngines, mkEngine, drawStroke, erase, descend } from "./__testkit__/harness";
import { loopArea } from "./geometry/arcShape";

jest.setTimeout(600000);
useEngines();

// A cheap deterministic RNG so a failure can be replayed.
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const all = (E) => {
    const out = [];
    for (const L of Object.keys(E.doc.nativesByLevel)) for (const o of E.doc.nativesByLevel[L]) out.push({ lvl: L, o });
    return out;
};
const openLoops = (E) => {
    let n = 0;
    for (const r of all(E)) {
        if (!r.o.loops) continue;
        for (const loop of r.o.loops) {
            const last = loop.at(-1), first = loop.at(0);
            if (last.B[0] !== first.A[0] || last.B[1] !== first.A[1]) n++;
        }
    }
    return n;
};

test("F1 — scribbles cut to pieces at one level", () => {
    let worst = null;
    for (let seed = 1; seed <= 30; seed++) {
        const R = rng(seed);
        const E = mkEngine(800, 600);
        const pts = [];
        for (let i = 0; i <= 40; i++) {
            pts.push([120 + i * 14 + R() * 40, 300 + Math.sin(i / 3 + seed) * 140 + R() * 30]);
        }
        drawStroke(E, pts, 20 + R() * 60, "#1133cc");
        for (let k = 0; k < 10; k++) {
            const x = 100 + R() * 600, y = 100 + R() * 400;
            erase(E, [[x, y], [x + (R() - 0.5) * 300, y + (R() - 0.5) * 300]], 4 + R() * 40);
        }
        const bad = openLoops(E);
        if (bad && !worst) worst = { seed, bad, fails: E._boolFailures || 0 };
    }
    // eslint-disable-next-line no-console
    console.log("F1 first failure:", worst ? JSON.stringify(worst) : "none in 30 seeds");
    expect(worst).toBe(null);
});

test("F2 — the same, cutting from a level below (the cede path)", () => {
    let worst = null;
    let failures = 0;
    for (let seed = 1; seed <= 20; seed++) {
        const R = rng(seed * 7);
        const E = mkEngine(800, 600);
        const pts = [];
        for (let i = 0; i <= 30; i++) pts.push([200 + i * 12 + R() * 30, 300 + Math.sin(i / 4 + seed) * 90]);
        drawStroke(E, pts, 20 + R() * 40, "#1133cc");
        descend(E, 1, 400, 300);
        for (let k = 0; k < 8; k++) {
            const x = 100 + R() * 600, y = 100 + R() * 400;
            erase(E, [[x, y], [x + (R() - 0.5) * 400, y + (R() - 0.5) * 400]], 6 + R() * 40);
        }
        failures += E._boolFailures || 0;
        const bad = openLoops(E);
        if (bad && !worst) worst = { seed, bad };
    }
    // eslint-disable-next-line no-console
    console.log("F2 first failure:", worst ? JSON.stringify(worst) : "none in 20 seeds",
        "| booleans refused across the run:", failures);
    expect(worst).toBe(null);
});

test("F3 — erases that land on top of each other, over and over", () => {
    let worst = null, failures = 0;
    for (let seed = 1; seed <= 12; seed++) {
        const R = rng(seed * 31);
        const E = mkEngine(800, 600);
        drawStroke(E, [[100, 300], [700, 300]], 60, "#1133cc");
        // Repeatedly erase in the SAME place: every pass after the first runs
        // its clip along an edge the previous one made, which is the geometry
        // most likely to leave a chain unclosed.
        for (let k = 0; k < 25; k++) {
            const jitter = (R() - 0.5) * 0.4;
            erase(E, [[300 + jitter, 240], [300 + jitter, 360]], 20);
        }
        failures += E._boolFailures || 0;
        const bad = openLoops(E);
        if (bad && !worst) worst = { seed, bad, objs: all(E).length };
    }
    // eslint-disable-next-line no-console
    console.log("F3 first failure:", worst ? JSON.stringify(worst) : "none in 12 seeds",
        "| booleans refused:", failures);
    expect(worst).toBe(null);
});

test("F6 — erasing DEEP into coarse ink: the clip that made #418", () => {
    // The other direction, and the one that actually did the damage. Erasing
    // several crossings below an object re-homes it: `_inkShapeInRect` projects
    // the coarse shape DOWN and clips it to a tile, so the boolean gets a
    // subject 3000^k times its own size against a tile-sized rect. Every vertex
    // of the result lives in the rect; the tolerance has to come from there.
    let bad = 0, failures = 0, ceded = 0;
    for (let depth = 1; depth <= 5; depth++) {
        for (let seed = 1; seed <= 3; seed++) {
            const R = rng(seed * 29 + depth);
            const E = mkEngine(800, 600);
            const pts = [];
            for (let i = 0; i <= 10; i++) pts.push([180 + i * 45, 300 + Math.sin(i / 2 + seed) * 60]);
            drawStroke(E, pts, 30 + R() * 40, "#1133cc");
            const before = all(E).length;
            descend(E, depth, 400, 300);
            // Through the point the descent centred on, so the ink is
            // certainly there — a random sweep at depth mostly misses.
            for (let k = 0; k < 3; k++) {
                const a = R() * Math.PI, dx = Math.cos(a) * 260, dy = Math.sin(a) * 260;
                erase(E, [[400 - dx, 300 - dy], [400 + dx, 300 + dy]], 8 + R() * 40);
            }
            failures += E._boolFailures || 0;
            bad += openLoops(E);
            if (all(E).length > before) ceded++;
        }
    }
    // eslint-disable-next-line no-console
    console.log("F6 open loops:", bad, "| booleans refused:", failures, "| runs that ceded a tile:", ceded, "/15");
    expect(ceded).toBeGreaterThan(3);        // the cede path really was exercised
    expect(bad).toBe(0);
    expect(failures).toBe(0);
});

test("F5 — ink drawn deep, erased from every level above it", () => {
    // The case that did the damage: the eraser is projected DOWN onto its
    // target and arrives 3000x larger per crossing, so at three crossings the
    // two operands differ in size by 2.7e10. Nothing about that is exotic — it
    // is what "zoom out and rub something out" does.
    let failures = 0, bad = 0, cut = 0;
    for (let depth = 1; depth <= 5; depth++) {
        for (let seed = 1; seed <= 4; seed++) {
            const R = rng(seed * 17 + depth);
            const E = mkEngine(800, 600);
            descend(E, depth, 400, 300);
            const pts = [];
            for (let i = 0; i <= 12; i++) pts.push([260 + i * 20, 300 + Math.sin(i / 2 + seed) * 40]);
            drawStroke(E, pts, 14 + R() * 30, "#1133cc");
            const before = all(E).filter((r) => !r.o.erase).length;
            let guard = 0;
            while (E.activeLevel > 0 && guard++ < 600) E.zoomAt(400, 300, 1000);
            for (let k = 0; k < 3; k++) {
                const x = 250 + R() * 300, y = 150 + R() * 300;
                erase(E, [[x, y], [x + (R() - 0.5) * 200, y + (R() - 0.5) * 200]], 10 + R() * 50);
            }
            failures += E._boolFailures || 0;
            bad += openLoops(E);
            if (all(E).filter((r) => !r.o.erase).length !== before) cut++;
        }
    }
    // eslint-disable-next-line no-console
    console.log("F5 open loops:", bad, "| booleans refused:", failures, "| runs where the erase bit:", cut, "/20");
    expect(bad).toBe(0);
    expect(failures).toBe(0);
});

test("F4 — a stroke erased until almost nothing is left", () => {
    let failures = 0, bad = 0;
    for (let seed = 1; seed <= 8; seed++) {
        const R = rng(seed * 101);
        const E = mkEngine(800, 600);
        drawStroke(E, [[150, 300], [650, 300]], 50, "#1133cc");
        for (let k = 0; k < 40; k++) {
            const x = 140 + R() * 520;
            erase(E, [[x, 260 + R() * 80], [x + 10, 260 + R() * 80]], 10 + R() * 30);
        }
        failures += E._boolFailures || 0;
        bad += openLoops(E);
        const area = all(E).filter((r) => !r.o.erase).reduce((a, r) => a + (r.o.loops ? r.o.loops.reduce((n, l) => n + loopArea(l), 0) : 0), 0);
        expect(area).toBeGreaterThanOrEqual(0);
    }
    // eslint-disable-next-line no-console
    console.log("F4 open loops:", bad, "| booleans refused:", failures);
    expect(bad).toBe(0);
});
