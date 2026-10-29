/**
 * deepzoom.scalars.probe.js — where the scalars that multiply a whole frame chain stop being finite (ROADMAP: the
 * infinite-zoom check). Builds a chain of cells n deep and prints frameFactor both ways, effectiveZoom, the zoom
 * label, and a point mapped down the chain and back. A probe, not a suite. Run:
 *   CI=true npx react-scripts test --watchAll=false --testMatch "**\/deepzoom.scalars.probe.js"
 */
import LevelMap from "./LevelMap";
import { BASE, ENTER, EXIT } from "./frameLattice";
import { zoomLabel } from "../hooks/useKobinEngine";

const log = (s) => { /* eslint-disable-next-line no-console */ console.log(s); };

test("frame-chain scalars by depth", () => {
    const M = new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);
    const ids = ["0"];
    for (let d = 0; d < 100; d++) ids.push(M.cellChild(ids[d], 1, -1).id);
    const rows = [];
    for (const n of [1, 40, 84, 85, 86, 89, 90, 100]) {
        const down = M.frameFactor("0", ids[n]), up = M.frameFactor(ids[n], "0");
        const p = M.mapPointF([123.456, -78.9], "0", ids[n]), back = p && M.mapPointF(p, ids[n], "0");
        const z = M.effectiveZoom(ids[n], 100);
        rows.push(`depth ${n}: frameFactor down ${down} up ${up}; effectiveZoom(inScale 100) ${z} label "${zoomLabel(z)}"; point down ${p && p.map((v) => v.toPrecision(4))} back ${back && back.map((v) => v.toPrecision(6))}`);
    }
    log(rows.join("\n"));
});
