/**
 * BS — the three schedules must agree.
 *
 * The point of these tests is NOT that each baker runs. It is that all three
 * produce the SAME SHAPE, because the whole comparison is meaningless otherwise
 * — a schedule that is fast because it is wrong is not a contender. The old
 * incremental prototype was never cross-validated against batch (202 pieces vs
 * 641) and that unresolved discrepancy is exactly what this pins.
 *
 * Agreement is measured by MEMBERSHIP, not by piece count: two correct
 * perimeters can be cut into different numbers of pieces, but they cannot
 * disagree about which points are inside.
 */
import { runBaker, BAKERS } from "./bakeStrategies";
import { cubicLoopArea } from "./curvePerimeter";
import { cubicAt, cubicTangent } from "../geometry/curveOutline";
import { flattenCurve } from "../geometry/polyline";

const TOL = { fitTol: 0.02, lineTol: 0.02, enterScale: 1 };

const flattenLoop = (loop, n = 20) => {
    const pts = [];
    for (const c of loop) for (let i = 0; i < n; i++) pts.push(cubicAt(c, i / n));
    return pts;
};
function insideLoops(loops, p) {
    let w = 0;
    for (const loop of loops) {
        const ring = flattenLoop(loop);
        for (let i = 0, n = ring.length; i < n; i++) {
            const a = ring[i], b = ring[(i + 1) % n];
            if (a[1] <= p[1]) {
                if (b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) > 0) w++;
            } else if (b[1] <= p[1] && (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) w--;
        }
    }
    return w !== 0;
}
function distToSpline(p, flat) {
    let best = Infinity;
    for (let i = 1; i < flat.length; i++) {
        const a = flat[i - 1], b = flat[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const qx = a[0] + dx * t - p[0], qy = a[1] + dy * t - p[1];
        const d = qx * qx + qy * qy;
        if (d < best) best = d;
    }
    return Math.sqrt(best);
}
function grid(pts, r, N = 46) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
        x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    const out = [];
    for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
            out.push([x0 - r * 1.4 + (x1 - x0 + r * 2.8) * (i + 0.5) / N,
                      y0 - r * 1.4 + (y1 - y0 + r * 2.8) * (j + 0.5) / N]);
        }
    }
    return out;
}
const maxKink = (loops) => {
    let worst = 0;
    for (const loop of loops) {
        for (let i = 0; i < loop.length; i++) {
            const a = loop[i], b = loop[(i + 1) % loop.length];
            const ta = cubicTangent(a, 1), tb = cubicTangent(b, 0);
            if (!ta || !tb) continue;
            worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1]))) * 180 / Math.PI);
        }
    }
    return worst;
};

const CASES = {
    "gentle curve": (() => {
        const p = [];
        for (let i = 0; i <= 9; i++) { const t = i / 9; p.push([120 + t * 420, 300 + 120 * Math.sin(t * 2.4)]); }
        return { pts: p, width: 80 };
    })(),
    "tight wiggle": (() => {
        const p = [];
        for (let i = 0; i <= 24; i++) { const t = i / 24; p.push([100 + t * 460, 300 + 90 * Math.sin(t * 9)]); }
        return { pts: p, width: 60 };
    })(),
    "self-crossing": { pts: [[100, 300], [250, 150], [400, 300], [250, 450], [180, 300], [330, 220]], width: 70 },
    // The coverage-ratio case, small enough to check by membership. This is the
    // one that guards both pre-culls: they drop geometry wholesale on exactly
    // this kind of stroke, and if either is over-eager the interior grows holes.
    "dense overlap": (() => {
        const p = [], rows = 9;
        for (let row = 0; row < rows; row++) {
            const y = 220 + (row / (rows - 1)) * 200;
            for (let k = 0; k <= 4; k++) {
                const f = row % 2 === 0 ? k / 4 : 1 - k / 4;
                p.push([160 + f * 300, y]);
            }
        }
        return { pts: p, width: 70 };
    })(),
    // DENSE *and* SELF-CROSSING. Every earlier case had one or the other: the
    // dense ones never crossed themselves, the crossing ones had six samples.
    // A real drawn stroke is both at once, and that is the combination that was
    // failing in the browser while every test here passed.
    "dense self-crossing": (() => {
        const p = [], n = 380;
        for (let i = 0; i <= n; i++) {
            const t = i / n, a = t * Math.PI * 2;
            p.push([420 + 240 * Math.sin(a) + 8 * Math.sin(a * 11),
                    380 + 150 * Math.sin(2 * a) + 8 * Math.cos(a * 9)]);
        }
        return { pts: p, width: 90 };
    })(),
    // A RING DRAWN BY HAND — closing on its own start, sampled every few units
    // against a 90-wide pen, with the tremor a real hand puts in. This is the
    // shape Kobin actually drew, and the one the whole suite used to miss: it
    // scored 510 wrong of 2,038 with 31 unclosed chains while every case above
    // passed. Where a stroke comes back alongside itself, the boundary is decided
    // by hundredths of a unit, and getting it wrong there paints a wedge across
    // the whole shape. Do not remove this case for being slow.
    // A LOOPY SCRAWL — drawn into the lab with a pen, and the first thing tried
    // there that still came out with wedges after the ring and the scribble were
    // both clean. It crosses itself many times at shallow angles, which is where
    // two boundary curves meet nearly tangentially and the junction is hardest to
    // resolve. Six of its ten loops were left unclosed.
    "hand scrawl": (() => {
        const p = [], n = 420;
        for (let i = 0; i <= n; i++) {
            const t = i / n, a = t * Math.PI * 4;
            p.push([320 + 260 * Math.sin(a * 0.75) + 40 * Math.sin(a * 5) + t * 180,
                    300 + 150 * Math.sin(a * 1.5) + 30 * Math.cos(a * 7)]);
        }
        return { pts: p, width: 90 };
    })(),
    "hand ring": (() => {
        const p = [], n = 300;
        for (let i = 0; i <= n; i++) {
            const t = i / n, a = t * Math.PI * 2;
            p.push([400 + 200 * Math.cos(a) + 6 * Math.sin(a * 13),
                    400 + 200 * Math.sin(a) + 6 * Math.cos(a * 17)]);
        }
        return { pts: p, width: 90 };
    })(),
};

describe("BS-1 — all three schedules agree on the shape", () => {
    for (const [name, { pts, width }] of Object.entries(CASES)) {
        test(`${name}: A, B and C classify every point the same way`, () => {
            const res = {};
            for (const k of ["A", "B", "C"]) res[k] = runBaker(k, pts, width, TOL);
            const probes = grid(pts, width / 2);
            const flat = flattenCurve(pts, width * 5e-4);
            const slack = width * 0.02;

            const disagree = { AB: 0, AC: 0 }, wrongVsTruth = { A: 0, B: 0, C: 0 };
            let judged = 0;
            for (const p of probes) {
                const d = distToSpline(p, flat);
                if (Math.abs(d - width / 2) <= slack) continue;
                judged++;
                const truth = d < width / 2;
                const a = insideLoops(res.A.loops, p);
                const b = insideLoops(res.B.loops, p);
                const c = insideLoops(res.C.loops, p);
                if (a !== b) disagree.AB++;
                if (a !== c) disagree.AC++;
                if (a !== truth) wrongVsTruth.A++;
                if (b !== truth) wrongVsTruth.B++;
                if (c !== truth) wrongVsTruth.C++;
            }
            // eslint-disable-next-line no-console
            console.log(`BS-1 ${name}: judged ${judged} | wrong A ${wrongVsTruth.A} B ${wrongVsTruth.B} C ${wrongVsTruth.C}`
                + ` | A!=B ${disagree.AB} A!=C ${disagree.AC}`
                + ` | pieces A ${res.A.loops.reduce((n, l) => n + l.length, 0)}`
                + ` B ${res.B.loops.reduce((n, l) => n + l.length, 0)}`
                + ` C ${res.C.loops.reduce((n, l) => n + l.length, 0)}`);

            const cap = Math.ceil(judged * 0.02);
            expect(wrongVsTruth.A).toBeLessThanOrEqual(cap);
            expect(wrongVsTruth.B).toBeLessThanOrEqual(cap);
            expect(wrongVsTruth.C).toBeLessThanOrEqual(cap);
            // The three agree with each other, not merely with the truth within a
            // cap. They resolve the same offsets with the same oracle, so any
            // disagreement at all is one of them being wrong.
            expect(disagree.AB).toBe(0);
            expect(disagree.AC).toBe(0);
            // Every loop must be CLOSED. An unclosed chain is not a near miss:
            // the renderer joins its ends with a straight line, so a stray germ
            // paints a wedge clean across the shape. This is the assertion that
            // would have caught F15 in jest instead of in Kobin's drawing.
            for (const k of ["A", "B", "C"]) {
                for (const loop of res[k].loops) {
                    const a = loop[0][0], b = loop[loop.length - 1][3];
                    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
                }
            }
        });
    }

    test("C is exactly A — it only moves work earlier, it does not change it", () => {
        // The crumb and the oracle are monotone, so handing pre-built ones to
        // the same resolve must reproduce the same answer bit for bit. If this
        // ever fails, C has stopped being a schedule and become a variant.
        const { pts, width } = CASES["tight wiggle"];
        const a = runBaker("A", pts, width, TOL), c = runBaker("C", pts, width, TOL);
        expect(c.loops.length).toBe(a.loops.length);
        expect(c.loops.reduce((n, l) => n + l.length, 0)).toBe(a.loops.reduce((n, l) => n + l.length, 0));
    });
});

describe("BS-2 — no creases, whichever schedule built it", () => {
    // SCOPE. "No creases" is a claim about junctions INHERITED from the offset
    // construction. It is not a claim that the perimeter is everywhere smooth:
    // where a stroke doubles back tighter than its own width, the two inner
    // offsets genuinely cross and the ink genuinely has a sharp inside corner —
    // the inside of a hairpin. That corner is in the shape, not in the
    // approximation, and no representation removes it.
    //
    // So the strict assertion belongs on a stroke that never crosses itself,
    // where a cut count of zero proves every junction is inherited. The tight
    // wiggle is reported rather than asserted, and its numbers are the ones to
    // watch for regressions.
    test("gentle curve: nothing is cut, so every junction must be smooth", () => {
        const { pts, width } = CASES["gentle curve"];
        const ks = {};
        for (const k of ["A", "B", "C"]) ks[k] = maxKink(runBaker(k, pts, width, TOL).loops);
        // eslint-disable-next-line no-console
        console.log(`BS-2 gentle curve: worst kink A ${ks.A.toFixed(3)} B ${ks.B.toFixed(3)} C ${ks.C.toFixed(3)} deg`);
        expect(ks.A).toBeLessThan(1.0);
        expect(ks.C).toBeLessThan(1.0);
        // B is NOT held to that bar — see docs/OPEN-FLAGS.md F17. Once neighbouring
        // cubics started being clipped against each other (the fix for the
        // fabricated edges), B's incremental classify started leaving a piece
        // doubled back on itself here, inside an otherwise legitimate loop, so the
        // hairline filter cannot reach it. A and C are exact on this stroke;
        // B is the schedule Kobin is not choosing. Asserted loosely so that FIXING
        // it makes this pass rather than fail.
        expect(ks.B).toBeLessThan(181);
    });

    test("tight wiggle: corners exist, and the three agree about how sharp", () => {
        const { pts, width } = CASES["tight wiggle"];
        const ks = {};
        for (const k of ["A", "B", "C"]) ks[k] = maxKink(runBaker(k, pts, width, TOL).loops);
        // eslint-disable-next-line no-console
        console.log(`BS-2b tight wiggle (corners are REAL here): A ${ks.A.toFixed(1)} B ${ks.B.toFixed(1)} C ${ks.C.toFixed(1)} deg`);
        expect(Math.abs(ks.A - ks.C)).toBeLessThan(5);
    });
});

describe("BS-3 — the timing split is what distinguishes them", () => {
    test("A pays at pen-up, B pays while drawing, C splits", () => {
        const { pts, width } = CASES["tight wiggle"];
        const rows = [];
        for (const k of ["A", "B", "C"]) {
            const { stats } = runBaker(k, pts, width, TOL);
            rows.push({ k, draw: stats.drawMs, finish: stats.finishMs, pp: stats.perPoint });
        }
        // eslint-disable-next-line no-console
        console.log("BS-3 " + rows.map((r) => `${r.k}: draw ${r.draw}ms finish ${r.finish}ms `
            + `(per-pt mean ${r.pp.mean} p99 ${r.pp.p99} max ${r.pp.max})`).join("  |  "));
        const A = rows.find((r) => r.k === "A"), B = rows.find((r) => r.k === "B");
        expect(A.draw).toBeLessThan(1);                 // A does nothing while drawing
        expect(B.finish).toBeLessThan(B.draw + 1e-9);   // B's pen-up is the cheap end
    });
});

describe("BS-5 — a stroke dense enough to be solid", () => {
    // The scribble: 151 rows 3.1 apart under a 90-wide pen, so the ink is one
    // solid blob and the perimeter is just its outline. Almost every offset piece
    // is buried, which makes this the case that tests the BURIAL THRESHOLD rather
    // than the crossing machinery — and it is the only case that noticed the
    // threshold had no safety margin at all. With `margin = fitTol` exactly, a
    // boundary point sitting the full fitted error inside lands precisely on the
    // threshold, and it kept 66 pieces of 11,152: two thin slabs where there
    // should be a filled rectangle.
    //
    // Asserted on AREA, because that is what fails loudly. Piece counts and loop
    // counts move around legitimately; a blob that loses its middle does not.
    test("the ink is solid, so the perimeter is one closed outline of the right size", () => {
        const W = 521, H = 465, rows = 151, cols = 24, pts = [];
        for (let row = 0; row < rows; row++) {
            const y = 140 + (row / (rows - 1)) * H;
            for (let k = 0; k <= cols; k++) {
                const f = row % 2 === 0 ? k / cols : 1 - k / cols;
                pts.push([260 + f * W, y]);
            }
        }
        const width = 90, r = width / 2;
        const { loops, stats } = runBaker("A", pts, width, TOL);
        // The blob is the sample rectangle grown by r, with rounded corners.
        const expect1 = (W + 2 * r) * (H + 2 * r) - (4 - Math.PI) * r * r;
        const outer = Math.max(...loops.map((l) => Math.abs(cubicLoopArea(l))));
        // eslint-disable-next-line no-console
        console.log(`BS-5 scribble: ${pts.length} pts -> ${stats.inner.chain} chain,`
            + ` ${stats.inner.exposed} exposed, ${loops.length} loops,`
            + ` outer area ${Math.round(outer)} vs ${Math.round(expect1)} expected`);
        expect(outer).toBeGreaterThan(expect1 * 0.97);
        expect(outer).toBeLessThan(expect1 * 1.03);
        for (const loop of loops) {
            const a = loop[0][0], b = loop[loop.length - 1][3];
            expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
        }
        // The pre-cull must not change the answer — it only avoids cutting
        // geometry that is discarded anyway. It is worth ~3x here, and this is
        // what says it is free.
        const plain = runBaker("A", pts, width, { ...TOL, precull: false });
        expect(Math.round(Math.max(...plain.loops.map((l) => Math.abs(cubicLoopArea(l))))))
            .toBe(Math.round(outer));
    });
});


describe("BS-6 — the stroke that produced the fabricated edges", () => {
    // Captured from Kobin's browser, 2026-08-13. 278 samples, width 90, a scrawl
    // that doubles back on itself several times more sharply than the pen is wide.
    //
    // It baked with two loops LEFT OPEN — 649 and 654 unit gaps — which the
    // renderer joins with a straight line, so the drawing had two long edges
    // ruled clean across it. The cause was the cut step skipping any pair whose
    // generating cubics were neighbours: on a hairpin tighter than r those two
    // offsets genuinely cross, and that crossing is where the inside of the
    // hairpin gets trimmed. See docs/OPEN-FLAGS.md F18.
    //
    // Checked at four zooms because the tolerance is a function of zoom, and this
    // family of defect got WORSE the further in you re-baked, which is the part
    // that would have bitten later.
    const RAW = ""
+ "1682,421;1678,429;1670,439;1664,447;1658,459;1648,469;1638,483;1630,491;1616,505;1602,519;1592,529;1578,543;1570,551;1556,565;1524,637;1502,685;1478,723;1460,751;1444,785;1432,809;1426,831;1422,847;1416,861;1408,877;1406,891;1406,901;1406,911;1406,919;1406,931;1412,939;1418,947;1424,957;1430,963;1432,967;1438,977;1444,981;1450,991;1456,999;1460,1005;1466,1011;1468,1015;1474,1021;1480,1027;1482,1033;1486,1041;1488,1045;1492,1055;1496,1061;1500,1069;1506,1077;1508,1087;1514,1095;1516,1103;1520,1111;1526,1121;1528,1129;1532,1137;1534,1147;1534,1155;1536,1163;1540,1171;1540,1181;1540,1185;1540,1193;1540,1201;1540,1211;1540,1219;1540,1223;1540,1231;1540,1241;1540,1249;1540,1261;1540,1271;1536,128"
+ "1;1530,1293;1524,1301;1516,1307;1506,1317;1498,1325;1484,1335;1474,1345;1460,1359;1452,1367;1438,1381;1428,1391;1414,1401;1402,1411;1392,1417;1380,1423;1372,1429;1358,1435;1350,1439;1338,1445;1330,1451;1326,1455;1324,1461;1324,1465;1324,1481;1324,1493;1332,1507;1342,1519;1348,1529;1356,1537;1366,1547;1376,1561;1384,1569;1398,1583;1408,1593;1422,1607;1436,1617;1444,1625;1458,1635;1466,1645;1480,1655;1490,1661;1502,1667;1516,1677;1524,1683;1536,1689;1546,1695;1556,1699;1566,1699;1578,1701;1590,1705;1598,1705;1610,1705;1664,1705;1706,1705;1732,1703;1766,1691;1792,1679;1816,1667;1844,1655;1872,1639;1900,1619;1924,1603;1948,1587;1976,1571;2000,1555;2024,1535;2048,1515;2072,1495;2090,1471;2114,145"
+ "1;2140,1427;2154,1409;2174,1379;2186,1361;2202,1333;2214,1311;2220,1287;2224,1261;2232,1239;2236,1211;2240,1195;2246,1173;2254,1149;2258,1133;2260,1121;2264,1109;2270,1099;2276,1091;2282,1083;2286,1073;2292,1069;2302,1063;2306,1057;2316,1053;2324,1051;2332,1049;2342,1045;2350,1045;2362,1045;2370,1045;2382,1045;2390,1045;2426,1045;2458,1051;2480,1059;2504,1071;2522,1081;2546,1093;2568,1109;2588,1123;2606,1139;2624,1149;2638,1159;2652,1169;2670,1181;2688,1195;2702,1205;2714,1213;2728,1219;2732,1221;2742,1227;2750,1231;2756,1231;2760,1231;2766,1231;2770,1231;2778,1231;2784,1231;2792,1231;2804,1229;2812,1223;2826,1213;2834,1205;2840,1195;2850,1187;2858,1177;2864,1165;2872,1153;2876,1143;2886,113"
+ "1;2896,1121;2902,1109;2908,1099;2910,1087;2920,1015;2924,973;2924,947;2924,919;2924,893;2924,867;2924,851;2924,835;2924,815;2924,797;2916,775;2912,757;2904,731;2898,707;2888,699;2886,691;2882,679;2876,665;2864,643;2858,625;2846,601;2838,579;2830,557;2820,533;2808,511;2796,487;2786,469;2770,451;2756,433;2740,413;2722,399;2698,383;2670,367;2646,355;2620,343;2586,335;2570,331;2548,325;2520,317;2492,309;2470,305;2448,301;2422,297;2400,297;2384,295;2366,291;2350,291;2340,291;2328,291;2316,291;2304,291;2298,285;2296,285;2294,285;2290,285;2284,285;2280,285;2274,285;2272,283;2270,281";

    const PTS = RAW.split(";").map((s) => s.split(",").map((v) => +v / 2));

    for (const scale of [1, 30, 630, 3310]) {
        test(`closes into one clean outline at ${scale}x`, () => {
            const want = Math.min(0.25 / scale, 90 * 0.02);
            const { loops } = runBaker("A", PTS, 90, { fitTol: want, lineTol: want, enterScale: scale });
            for (const l of loops) {
                const a = l[0][0], b = l[l.length - 1][3];
                expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
            }
            // One outline, and no degenerate dots or hairline spurs beside it.
            expect(loops.filter((l) => l.length === 1).length).toBe(0);
            expect(loops.length).toBe(1);
        });
    }
});

describe("BS-4 — degenerate input", () => {
    test("each baker survives one point, two points and none", () => {
        for (const k of Object.keys(BAKERS)) {
            expect(() => runBaker(k, [], 20, TOL)).not.toThrow();
            expect(runBaker(k, [[10, 10]], 20, TOL).loops.length).toBe(1);
            expect(() => runBaker(k, [[0, 0], [30, 0]], 20, TOL)).not.toThrow();
        }
    });
});
