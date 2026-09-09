/**
 * legacyFixture.js — re-express a PRE-LATTICE recording in lattice coordinates.
 *
 * D8 says the product refuses a legacy file rather than converting it, and that
 * is right: converting user data means rewriting stored coordinates, which is
 * the one operation the whole design exists to avoid. This is not user data.
 * `.kobin-reports/*.json` are recordings of sessions where Kobin hit real bugs —
 * RR-1 through RR-8, RT-4 — and every one of those bugs is about ERASING and
 * BAKING, not about frames. The frame model they happen to be written in is
 * incidental to what they pin, so throwing them away would lose coverage of
 * reported defects for no reason connected to the change.
 *
 * WHAT THE CONVERSION IS. Pick the coarsest recorded level and declare its
 * coordinates unchanged. Every other legacy level has a known transform to it
 * (compose the recorded {s, t} edges), and every lattice frame has a known
 * transform to it too. So for each legacy level:
 *
 *   1. take a point the level's content actually sits on (its centroid),
 *   2. carry it up to the anchor level through the LEGACY edges,
 *   3. walk DOWN from the anchor through the lattice to the same depth, taking
 *      at each step the cell that point falls in,
 *   4. rewrite the level's natives into that cell's coordinates.
 *
 * The composite map from legacy-frame units to lattice-frame units is a uniform
 * scale of (R_new / R_old)^k plus a translation — a similarity — so arcs stay
 * arcs, widths scale with the geometry, and THE PICTURE IS UNCHANGED: a level-k
 * native is (R_new/R_old)^k larger in its own units and is divided by R_new^k
 * instead of R_old^k on the way back out, and the two cancel exactly.
 */
import LevelMap from "../LevelMap";
import { BASE, ENTER, EXIT, R as R_NEW, G, W as FRAME_W, cellOf, carryDigit } from "../frameLattice";

const LEGACY_BASE = 0.1;   // the pre-lattice base; its enter was 300, so its crossing ratio was 3000

/** Is this a snapshot from before the lattice? Both old shapes count. */
export function isLegacySnapshot(snap) {
    const cr = snap && snap.crossings;
    if (!cr || cr.__lattice) return false;
    if (Array.isArray(cr.__frames)) return true;
    return Object.keys(cr).some((k) => Number.isInteger(+k));
}

/**
 * The legacy tree, normalized: id -> { id, parent, depth, edge }. Both old
 * shapes reduce to this — the per-depth dict is just a spine whose ids are the
 * depth as a string.
 */
function legacyTree(cr) {
    const out = new Map();
    if (Array.isArray(cr.__frames)) {
        for (const f of cr.__frames) out.set(f.id, { id: f.id, parent: f.parent, depth: f.depth, edge: f.edge || null });
        return out;
    }
    const depths = Object.keys(cr).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
    if (!depths.length) return out;
    const lo = depths[0] - 1, hi = depths[depths.length - 1];
    for (let d = lo; d <= hi; d++) {
        out.set(String(d), { id: String(d), parent: d === lo ? null : String(d - 1), depth: d, edge: cr[d] || null });
    }
    return out;
}

// The legacy record for depth d maps depth d-1 -> depth d.
const downLegacy = (p, rec) => [(p[0] * LEGACY_BASE - rec.t.x) / rec.s, (p[1] * LEGACY_BASE - rec.t.y) / rec.s];

// A serialized shape carries its perimeter ENCODED — `loops` is an array of
// flat numeric runs, not an array of piece objects — so both shapes have to be
// understood here or the aim point silently comes out as the origin.
const isEncodedLoops = (L) => Array.isArray(L) && L.length > 0 && Array.isArray(L[0]) && typeof L[0][0] === "number";

const centroidOf = (objs) => {
    let n = 0, sx = 0, sy = 0;
    const take = ([x, y]) => { if (isFinite(x) && isFinite(y)) { sx += x; sy += y; n++; } };
    for (const o of objs) {
        if (o.pts) for (const p of o.pts) take(p);
        else if (o.polys) for (const poly of o.polys) for (const p of poly) take(p);
        else if (isEncodedLoops(o.loops)) {
            for (const a of o.loops) {
                take([a[0], a[1]]);
                let i = 2;
                while (i < a.length) { if (a[i] === 0) { take([a[i + 1], a[i + 2]]); i += 3; } else { take([a[i + 6], a[i + 7]]); i += 8; } }
            }
        } else if (Array.isArray(o.loops)) {
            for (const loop of o.loops) for (const pc of loop) { if (pc && pc.A) take(pc.A); }
        }
    }
    return n ? [sx / n, sy / n] : [0, 0];
};

/** The bbox of a serialized native — encoded loops, polys or pts. */
function objBBox(o) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const t = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    if (isEncodedLoops(o.loops)) {
        for (const a of o.loops) {
            t(a[0], a[1]);
            let i = 2;
            while (i < a.length) { if (a[i] === 0) { t(a[i + 1], a[i + 2]); i += 3; } else { t(a[i + 6], a[i + 7]); i += 8; } }
        }
    } else if (o.polys) { for (const poly of o.polys) for (const p of poly) t(p[0], p[1]); }
    else if (o.pts) { for (const p of o.pts) t(p[0], p[1]); }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

/**
 * Convert a dev-0 snapshot, returning a NEW one with `crossings` in lattice
 * form and every native rewritten into its cell.
 *
 * TWO THINGS THIS HAS TO GET RIGHT, both learned the hard way.
 *
 * 1. THE MAPPERS MUST COMPOSE. Each frame's legacy-to-lattice map is built FROM
 *    ITS PARENT'S, never independently. Severance compares a child's attachRect,
 *    mapped up into its parent, against the parent's own cut boundary, and that
 *    comparison is a coincidence test — two maps that agree only to a rounding
 *    put the rect a hair off the cut and the family falls into pieces that were
 *    one object before the conversion.
 *
 * 2. AN OUT-OF-RANGE DIGIT IS A CARRY, NOT A CLAMP. A legacy frame could be
 *    anchored anywhere, so a child's ink sometimes lands just outside the cell
 *    its parent's ink chose. Clamping strands the content; carrying moves it to
 *    the neighbouring cell, which is where it actually is. `LevelMap.neighbour`
 *    already does that arithmetic and is tested, so it does it here too.
 */
export function convertLegacySnapshot(snap) {
    const cr = snap.crossings || {};
    const tree = legacyTree(cr);
    const natives = snap.natives || {};
    if (!tree.size) return { ...snap, crossings: { __lattice: 1, frames: [] } };

    let root = null;
    for (const f of tree.values()) if (!root || f.depth < root.depth) root = f;

    const M = new LevelMap({ base: BASE, enter: ENTER, exit: EXIT, bufferScreens: 1 }, 800, 600);
    const rootId = M.ensureSpine(root.depth);

    // mapOf: legacy frame id -> { id, f, ox, oy }, where a point p in the legacy
    // frame's units is at p*f + o in the lattice frame's units.
    const mapOf = new Map([[root.id, { id: rootId, f: 1, ox: 0, oy: 0 }]]);
    const applyMap = (m, [x, y]) => [x * m.f + m.ox, y * m.f + m.oy];

    for (const f of [...tree.values()].sort((a, b) => a.depth - b.depth)) {
        if (f.id === root.id) continue;
        const pm = mapOf.get(f.parent);
        if (!pm || !f.edge) continue;
        const s0 = f.edge.s, t0 = f.edge.t;
        // Where this frame's ink sits, in its PARENT's lattice coordinates.
        const aim = centroidOf(natives[f.id] || []);
        const inParent = applyMap(pm, downLegacy(aim, f.edge));
        const raw = cellOf(inParent[0], inParent[1]);
        const ci = carryDigit(raw.i), cj = carryDigit(raw.j);
        // A carry means the ink is under a NEIGHBOUR of the parent's cell. That
        // frame's coordinates are offset by whole frames, which is exact.
        let baseId = pm.id, shiftX = 0, shiftY = 0;
        if (ci.carry || cj.carry) {
            const n = M.neighbour(pm.id, ci.carry, cj.carry);
            if (n) { baseId = n.id; shiftX = ci.carry * FRAME_W; shiftY = cj.carry * FRAME_W; }
        }
        const child = M.cellChild(baseId, ci.digit, cj.digit);
        if (!child) continue;
        // Compose: legacy parent = (child*base - t)/s, then lattice child =
        // (parent' - shift - digit*G) * R.
        mapOf.set(f.id, {
            id: child.id,
            f: pm.f * R_NEW * LEGACY_BASE / s0,
            ox: (pm.ox - (t0.x / s0) * pm.f - shiftX - ci.digit * G) * R_NEW,
            oy: (pm.oy - (t0.y / s0) * pm.f - shiftY - cj.digit * G) * R_NEW,
        });
    }

    const outNatives = {};
    for (const legacyId of Object.keys(natives)) {
        const m = mapOf.get(legacyId);
        if (!m || !isFinite(m.f) || m.f === 0) continue;
        const pt = ([x, y]) => [x * m.f + m.ox, y * m.f + m.oy];
        const list = (natives[legacyId] || []).map((o) => {
            const q = { ...o };
            if (o.pts) q.pts = o.pts.map(pt);
            if (o.polys) q.polys = o.polys.map((poly) => poly.map(pt));
            if (o.lwFrame != null) q.lwFrame = o.lwFrame * m.f;
            if (o.w != null) q.w = o.w * m.f;
            if (isEncodedLoops(o.loops)) q.loops = scaleEncodedLoops(o.loops, m);
            else if (o.L) q.L = scaleEncodedLoops(o.L, m);
            if (o.attachRect) {
                const a = pt([o.attachRect.x0, o.attachRect.y0]), b = pt([o.attachRect.x1, o.attachRect.y1]);
                q.attachRect = { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
            }
            return q;
        });
        outNatives[m.id] = (outNatives[m.id] || []).concat(list);
    }

    // INVARIANT 2, restored. A legacy frame could be anchored anywhere — up to
    // REUSE_RADIUS = 1e9 from its own origin — so re-expressing one puts its ink
    // wherever that lands, and measured on two of these recordings that was
    // 27,779 CELLS from the frame holding it. The lattice's locality rules
    // assume at most one, and the tile machinery quite correctly cannot find
    // content that far outside: an object drawn IN the lattice can never get
    // there (it is drawn at the camera's cell, and D9 promotes anything
    // over-wide), so this is the conversion's problem to fix, not the engine's.
    //
    // Each object moves to the cell that actually contains it. The offset is a
    // whole number of frames, which is exact, and every mapper stays exactly
    // composable — so a child's doorway still lands on its parent's cut and
    // severance is undisturbed.
    for (const id of Object.keys(outNatives)) {
        const keep = [];
        for (const o of outNatives[id]) {
            const b = objBBox(o);
            if (!b) { keep.push(o); continue; }
            const di = Math.round(((b.x0 + b.x1) / 2) / FRAME_W);
            const dj = Math.round(((b.y0 + b.y1) / 2) / FRAME_W);
            if (!di && !dj) { keep.push(o); continue; }
            const to = M.neighbour(id, di, dj);
            if (!to) { keep.push(o); continue; }
            const m = { f: 1, ox: -di * FRAME_W, oy: -dj * FRAME_W };
            const pt = ([x, y]) => [x + m.ox, y + m.oy];
            const q = { ...o };
            if (o.pts) q.pts = o.pts.map(pt);
            if (o.polys) q.polys = o.polys.map((poly) => poly.map(pt));
            if (isEncodedLoops(o.loops)) q.loops = scaleEncodedLoops(o.loops, m);
            if (o.attachRect) {
                q.attachRect = { x0: o.attachRect.x0 + m.ox, x1: o.attachRect.x1 + m.ox,
                    y0: o.attachRect.y0 + m.oy, y1: o.attachRect.y1 + m.oy };
            }
            (outNatives[to.id] = outNatives[to.id] || []).push(q);
        }
        outNatives[id] = keep;
    }
    for (const id of Object.keys(outNatives)) if (!outNatives[id].length) delete outNatives[id];

    const camIn = snap.camera || { inScale: 1, inPanX: 0, inPanY: 0, activeLevel: 0 };
    const camLegacyId = camIn.frame != null && tree.has(camIn.frame) ? camIn.frame : String(camIn.activeLevel || 0);
    const camM = mapOf.get(camLegacyId);
    const camera = { ...camIn };
    if (camM && isFinite(camM.f) && camM.f !== 0) {
        camera.frame = camM.id;
        // screen = frame*inScale + pan must not move under frame' = frame*f + o
        camera.inScale = (camIn.inScale || 1) / camM.f;
        camera.inPanX = (camIn.inPanX || 0) - camM.ox * camera.inScale;
        camera.inPanY = (camIn.inPanY || 0) - camM.oy * camera.inScale;
    }

    return { ...snap, crossings: M.serialize(), natives: outNatives, camera };
}

/**
 * Scale a shape's ENCODED loops in place-safe fashion.
 *
 * The codec is a flat numeric run per loop: a leading A point, then per piece
 * either `0, Bx, By` for a line or `1, Cx, Cy, r, a0, sweep, Bx, By` for an arc.
 * Only the lengths move under a similarity — `a0` and `sweep` are angles and a
 * uniform scale does not touch them, which is exactly the property the arc
 * representation exists for. Touching the array directly rather than decoding
 * and re-encoding matters: a round trip would re-derive each centre from the
 * scaled endpoints and quietly change what the fixture recorded.
 */
function scaleEncodedLoops(L, m) {
    if (!Array.isArray(L)) return L;
    return L.map((a) => {
        if (!Array.isArray(a) || a.length < 5) return a;
        const out = a.slice();
        const X = (v) => v * m.f + m.ox, Y = (v) => v * m.f + m.oy;
        out[0] = X(a[0]); out[1] = Y(a[1]);
        let i = 2;
        while (i < out.length) {
            if (a[i] === 0) {
                out[i + 1] = X(a[i + 1]); out[i + 2] = Y(a[i + 2]);
                i += 3;
            } else {
                out[i + 1] = X(a[i + 1]); out[i + 2] = Y(a[i + 2]);
                out[i + 3] = a[i + 3] * m.f;          // radius scales
                // a[i+4] a0 and a[i+5] sweep are angles: unchanged
                out[i + 6] = X(a[i + 6]); out[i + 7] = Y(a[i + 7]);
                i += 8;
            }
        }
        return out;
    });
}

/** Load a legacy-or-lattice snapshot into an engine. Returns false if unusable. */
export function loadFixture(E, snap) {
    if (!snap) return false;
    return E.loadSnapshot(isLegacySnapshot(snap) ? convertLegacySnapshot(snap) : snap);
}
