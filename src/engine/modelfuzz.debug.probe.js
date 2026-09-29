import { runPairFuzz, framesToCompare, pictureAt } from "./__testkit__/modelFuzz";

jest.setTimeout(20 * 60 * 1000);
test("debug", () => {
    const rows = [];
    runPairFuzz(1, 12, (O, N, step, op) => {
        const fr = framesToCompare(O, N);
        const r = { step, op, cam: N.cam.frame, lvl: N.activeLevel, natives: Object.keys(N.doc.nativesByLevel).map((k) => k + ":" + N.doc.count(k)).join(" "), frames: {} };
        for (const V of fr) { const a = pictureAt(O, V), b = pictureAt(N, V); r.frames[V] = [a ? a.size : -1, b ? b.size : -1, a ? [...a.values()].reduce((s, x) => s + x.length, 0) : -1]; }
        rows.push(r);
    });
    // eslint-disable-next-line no-console
    console.log(rows.map((r) => JSON.stringify(r)).join("\n"));
});
