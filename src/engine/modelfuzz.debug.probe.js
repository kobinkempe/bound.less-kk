import { runPairFuzz, framesToCompare, pictureAt, comparePictures } from "./__testkit__/modelFuzz";

jest.setTimeout(20 * 60 * 1000);
const SEED = Number(process.env.DBG_SEED || 5), STEP = Number(process.env.DBG_STEP || 8);
test("debug", () => {
    const out = [];
    runPairFuzz(SEED, STEP + 1, (O, N, step, op) => {
        if (step < STEP) return true;
        const st = { items: 0, exact: 0, carried: 0, carriedExact: 0, carriedUlp: 0, maxUlp: 0 };
        for (const V of framesToCompare(O, N)) {
            const d = comparePictures(O, N, V, st);
            if (!d) continue;
            out.push("DIFF " + d);
            const id = Number(/native (\d+)/.exec(d)[1]);
            const a = pictureAt(O, V).get(id) || [], b = pictureAt(N, V).get(id) || [];
            const ho = O.doc.getById(id), hn = N.doc.getById(id);
            out.push("homes O " + (ho && ho.level) + " N " + (hn && hn.level) + " V " + V + " cam " + N.cam.frame);
            out.push("own O " + JSON.stringify(ho && ho.obj.below) + " N " + JSON.stringify(hn && hn.obj.below));
            out.push("shift O " + JSON.stringify(ho && (O.lm.frame(ho.level) || {}).shift) + " N " + JSON.stringify(hn && (N.lm.frame(hn.level) || {}).shift) + " table N " + JSON.stringify(hn && N.doc.tableOf(hn.obj)));
            const f = (x) => ({ type: x.type, n: x.nums.length, off: x.off, own: x.own, head: x.nums.slice(0, 4) });
            out.push("O items " + JSON.stringify(a.map(f)));
            out.push("N items " + JSON.stringify(b.map(f)));
            out.push("O placement " + JSON.stringify(O.stage.model.placement(ho.obj, V)) + " N placement " + JSON.stringify(N.stage.model.placement(hn.obj, V)));
        }
        return false;
    });
    // eslint-disable-next-line no-console
    console.log(out.join("\n"));
});
