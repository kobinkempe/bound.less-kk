// B-MODEL-C34 scratch probe (deleted before hand-back).
import { runPairFuzz, framesToCompare, comparePictures, pictureAt, placeOf, frameAtPlace } from "./__testkit__/modelFuzz";

jest.setTimeout(600000);
const SEED = Number(process.env.DBG_SEED || 15), STOP = Number(process.env.DBG_STEP || 22), ID = Number(process.env.DBG_ID || 12);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

test("debug", () => {
    const st = { tainted: new Map() };
    runPairFuzz(SEED, STOP + 1, (O, N, step, op) => {
        if (step < STOP - 1) { for (const V of framesToCompare(O, N)) comparePictures(O, N, V, st); return true; }
        const ro = O.doc.getById(ID), rn = N.doc.getById(ID);
        const desc = (E, rec) => {
            if (!rec) return "none";
            const f = E.lm.frame(rec.level);
            return JSON.stringify({ home: rec.level, place: placeOf(E, rec.level), shadowOf: f && f.shadowOf, shift: f && f.shift, below: rec.obj.below, frameShift: f && f.shift });
        };
        log(`step ${step} op ${op} cam O ${O.cam.frame} N ${N.cam.frame}\n O ${desc(O, ro)}\n N ${desc(N, rn)}`);
        for (const V of framesToCompare(O, N)) {
            const VO = frameAtPlace(O, placeOf(N, V));
            const a = pictureAt(O, VO), b = pictureAt(N, V);
            const ia = a ? a.get(ID) : null, ib = b ? b.get(ID) : null;
            log(` V ${V} (O ${VO}) depth ${N.lm.depthOf(V)}: O items ${ia ? ia.length : 0} ${JSON.stringify((ia || []).map((x) => [x.own, x.si, x.sj, x.off]))} | N items ${ib ? ib.length : 0} ${JSON.stringify((ib || []).map((x) => [x.own, x.si, x.sj, x.off]))}`);
            const d = comparePictures(O, N, V, st);
            if (d) log("   diff: " + d);
        }
        if (step === STOP) {
            const cf = (E) => [...E.lm.frames.values()].filter((f) => E.doc.count(f.id)).map((f) => f.id + (f.shadowOf ? "~" + f.shadowOf : "") + ":" + E.doc.count(f.id)).join(" ");
            log(" O frames " + cf(O));
            log(" N frames " + cf(N));
        }
        return true;
    }, { c34: true });
});
