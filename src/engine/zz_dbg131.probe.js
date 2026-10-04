/* Scratch debug probe (deleted before commit): seed 131's reload2 at step 39, native 14. */
import { runPairFuzz, framesToCompare, comparePictures, pictureAt, placeOf, frameAtPlace, settleOracle, CELL } from "./__testkit__/modelFuzz";
jest.setTimeout(10 * 60 * 1000);
const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };
const SEED = Number(process.env.DBG_SEED || 131), STEP = Number(process.env.DBG_STEP || 39), ID = Number(process.env.DBG_ID || 14), C34 = process.env.DBG_C34 === "1";
const fr = (E, id) => { const f = E.lm.frame(String(id)); return f ? { id: f.id, parent: f.parent, depth: f.depth, shadowOf: f.shadowOf, private: f.private, shift: f.shift, kids: f._kids ? f._kids.size : 0, n: E.doc.count(f.id) } : null; };
test("dbg", () => {
    const st = {};
    runPairFuzz(SEED, STEP + 1, (O, N, step, op) => {
        if (step < STEP) {
            const hn = N.doc.getById(ID), ho = O.doc.getById(ID);
            const co = [...N.lm.frames.values()].filter((f) => String(f.id).includes("#")).map((f) => f.id + (f.shadowOf ? "~" + f.shadowOf : "") + (f.private ? "P" : "") + "n" + N.doc.count(f.id));
            log("TL " + step + " " + op + " live14=" + (hn ? hn.level + (N.lm.frame(String(hn.level)) ? "" : " MISSING") : "-") + " oracle14=" + (ho ? ho.level : "-") + " cam=" + N.cam.frame + " co=" + co.join(","));
            for (const V of framesToCompare(O, N)) comparePictures(O, N, V, st, C34 ? 2 : 1); return true;
        }
        const out = { step, op };
        for (const V of framesToCompare(O, N)) {
            const d = comparePictures(O, N, V, st, C34 ? 2 : 1);
            if (!d) continue;
            out.d = d; out.V = V;
            const hn = N.doc.getById(ID), ho = O.doc.getById(ID);
            out.live = hn ? { home: hn.level, frame: fr(N, hn.level), place: placeOf(N, hn.level), table: N.doc.tableOf(hn.obj), own: N.doc.ownTable(hn.obj) } : null;
            out.oracle = ho ? { home: ho.level, frame: fr(O, ho.level), place: placeOf(O, ho.level) } : null;
            out.Vlive = fr(N, V); out.Vplace = placeOf(N, V);
            const VO = frameAtPlace(O, placeOf(N, V)); out.VO = VO;
            settleOracle(O);
            const a = pictureAt(O, VO), b = pictureAt(N, V);
            out.oItems = a && a.get(ID) ? a.get(ID).map((x) => ({ off: x.off, si: x.si, sj: x.sj, own: x.own })) : [];
            out.nItems = b && b.get(ID) ? b.get(ID).map((x) => ({ off: x.off, si: x.si, sj: x.sj, own: x.own })) : [];
            out.wanted = N.store.wanted ? N.store.wanted() : null;
            const memo = N.store._rrMemo && N.store._rrMemo.get(String(V));
            if (memo) { out.miss = memo.miss ? [...memo.miss] : null; out.groups = [...memo.groups.entries()].map(([k, g]) => ({ k, F0: g.F0, has: N.lm.frame(String(g.F0)) ? 1 : 0, rem: g.rem, ids: [...g.ids].slice(0, 8) })).filter((g) => g.ids.includes(ID)); }
            if (hn) out.objShift = N.lm.objShift(N.doc.tableOf(hn.obj), hn.level, V, false);
            break;
        }
        log("DBG " + JSON.stringify(out));
        return false;
    }, { c34: C34 });
});
