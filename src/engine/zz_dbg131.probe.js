/* Scratch debug probe (deleted before commit): seed 131's reload2 at step 39, native 14. */
const { runPairFuzz, framesToCompare, comparePictures, pictureAt, placeOf, frameAtPlace, settleOracle, CELL } = process.env.DBG_OLD ? require("./__testkit__/zz_modelFuzzOld") : require("./__testkit__/modelFuzz");
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
            const pbb = (E, VV) => { const out = []; const snap = E.stage.snapshot(VV, CELL, Infinity); for (const it of snap ? snap.items() : []) { if (it.id !== ID) continue; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const q = (p) => { if (!p) return; x0 = Math.min(x0, p[0] + it.off[0]); x1 = Math.max(x1, p[0] + it.off[0]); y0 = Math.min(y0, p[1] + it.off[1]); y1 = Math.max(y1, p[1] + it.off[1]); }; const pc = it.piece; for (const l of pc.loops || []) for (const e of l || []) { q(e.A); q(e.B); } for (const r of pc.polys || []) for (const p of r) q(p); for (const p of pc.pts || []) q(p); out.push({ si: it.si, sj: it.sj, key: it.key, bb: [x0, y0, x1, y1].map((v) => +v.toFixed(3)) }); } return out; };
            out.oPieces = pbb(O, VO); out.nPieces = pbb(N, V);
            if (a && b && a.get(ID) && b.get(ID)) { const x = a.get(ID)[0].nums, y = b.get(ID)[0].nums; const d = []; for (let i = 0; i < x.length && d.length < 6; i++) if (x[i] !== y[i]) d.push([i, x[i], y[i]]); let mx = 0, mu = 0; for (let i = 0; i < x.length; i++) { const dd = Math.abs(x[i] - y[i]); if (dd > mx) mx = dd; const u = Math.pow(2, Math.floor(Math.log2(Math.max(Math.abs(x[i]), Math.abs(y[i]), 1e-300))) - 52); if (dd / u > mu) mu = dd / u; }
                out.numDiff = { n: x.length, maxAbs: mx, maxUlps: mu, first: d, count: x.filter((v, i) => v !== y[i]).length, type: a.get(ID)[0].type }; }
            out.idTiles = N.store._idTiles && N.store._idTiles.get(ID) ? [...N.store._idTiles.get(ID)] : null;
            out.cacheWith = []; for (const [k, t] of N.store.cache) if (t.objs && t.objs.some((q) => q.id === ID)) out.cacheWith.push(k + " live=" + !!N.lm.frame(t.level));
            const bb = () => null;
            out.oItems = a && a.get(ID) ? a.get(ID).map((x) => ({ off: x.off, si: x.si, sj: x.sj, own: x.own, n: x.nums.length })) : [];
            out.nItems = b && b.get(ID) ? b.get(ID).map((x) => ({ off: x.off, si: x.si, sj: x.sj, own: x.own, n: x.nums.length })) : [];
            if (ho) { const bx = O.stage.placeNative(ho.obj, VO).box(); out.oBox = bx && [bx.left, bx.top, bx.right, bx.bottom].map((v) => +v.toFixed(3)); }
            if (hn && ho) {
                const H = String(hn.level), b = (E, o, F) => { const x = E.stage.placeNative(o, F).box(); return x && [x.left, x.top, x.right, x.bottom]; };
                out.homeO = b(O, ho.obj, String(ho.level)); out.homeN = b(N, hn.obj, H);
                const hb = out.homeN; const m = N.lm.mapRectF({ left: hb[0], top: hb[1], right: hb[2], bottom: hb[3] }, H, V); out.mapped = [m.left, m.top, m.right, m.bottom];
            }
            if (hn) { const bx = N.stage.placeNative(hn.obj, V).box(); out.nBox = bx && [bx.left, bx.top, bx.right, bx.bottom].map((v) => +v.toFixed(3)); }
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
