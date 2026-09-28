/* global BigInt */
/**
 * level.js — the picture pyramid's level arithmetic (A3 §1.2, §1.6; PLAN §1.2). A LEVEL ℓ is an integer
 * zoom Z(ℓ) = 2^(ℓ·S) device px per frame unit, S = the level step in octaves; finer is larger. The view
 * draws from the level whose stretch σ = Z / Z(ℓ) lies in [σmin, σmin·2^S), and a plate (i, j) of one
 * frame's level is a plate of any other frame's level by integer arithmetic on the lattice's cell
 * digits, never by a float affine.
 *
 * Pure: integers and powers of two, no state. `plate.js` keeps the grid (`plateRange`, the origin); the
 * constants the pyramid's plan and store share (the view's plate bound, the compose's image cap) live here.
 */
import { R, W } from "../frameLattice";
import { PLATE_PX } from "./plate";

/** The level steps the Dev lever offers (PLAN §5.1): each divides the crossing's 12 octaves. */
export const LEVEL_STEPS = Object.freeze([1, 2, 3]);
/** The default level step: whole doublings (Kobin's decision 1). */
export const LEVEL_STEP = 1;
/** Octaves the view keeps its level past either edge of the band, so the level cannot flap. */
export const LEVEL_HYST = 1 / 8;
/** The band's floor: a view is never minified past 2^−½ (at S = 1 the band is nearest rounding). */
export const SIGMA_MIN = 2 ** -0.5;
/** Plates a view may need before its σmin rises to 1, then 2^½ (A3 §1.3). */
export const VIEW_PLATES_MAX = 48;
/**
 * Distinct images one compose draws directly, and the scaled images (stand-ins) a plan may draw beside the plane's:
 * past ~33 scaled images Chrome's 2D canvas flushes per image (A3 §1.5, E6; PLAN §5.6 M1).
 */
export const COMPOSE_IMAGES = 30;

const CROSS_OCT = Math.log2(R);                       // 12: a crossing is 4096×
const OFFSET_OCT = Math.log2(W) - Math.log2(PLATE_PX); // 8: a child cell's offset is its digit × 2^(8 + ℓS) plates
const LEVEL_FLOOR = -OFFSET_OCT;                       // −8: the coarsest ℓS a frame keeps as its own

/** Device px per frame unit at level ℓ: 2^(ℓS), exact. */
export const zOf = (l, S) => 2 ** (l * S);

/** Does step S keep the map between frames integral (S | 12)? */
export const stepMapsFrames = (S) => Number.isInteger(S) && S > 0 && CROSS_OCT % S === 0;

/** The coarsest level of a frame's own pyramid: ℓS ≥ −8. Coarser is its parent's level ℓ + 12/S. */
export const ownFloor = (S) => Math.ceil(LEVEL_FLOOR / S);

/**
 * The level a view at zoom Z draws from: ℓ = floor((log2 Z − log2 σmin) / S), so σ ∈ [σmin, σmin·2^S).
 * `prev` is kept while σ stays inside that band grown by LEVEL_HYST each way. A zoom that is not a
 * positive number reads as `prev`, or level 0.
 */
export function levelFor(Z, S, prev = null, sigmaMin = SIGMA_MIN) {
    if (!(Z > 0) || !isFinite(Z)) return prev != null ? prev : 0;
    const t = Math.log2(Z) - Math.log2(sigmaMin);
    if (prev != null && t >= prev * S - LEVEL_HYST && t < (prev + 1) * S + LEVEL_HYST) return prev;
    return Math.floor(t / S);
}

/** The stretch band [σmin, σmin·2^S) a view draws its level at: what the Dev panel shows beside the step. */
export const stretchBand = (S, sigmaMin = SIGMA_MIN) => [sigmaMin, sigmaMin * 2 ** S];

/**
 * The most plates a view of wDev × hDev device px can touch drawn at stretch σ: a span of L plates at
 * any pan phase touches ceil(L) + 1 of them.
 */
export function viewPlates(sigma, wDev, hDev) {
    const s = sigma * PLATE_PX;
    return (Math.ceil(wDev / s) + 1) * (Math.ceil(hDev / s) + 1);
}

/** σmin for a screen: 2^−½ while the view needs at most VIEW_PLATES_MAX plates at the band's hysteresis edge, else 1, else 2^½. */
export function sigmaMinFor(wDev, hDev) {
    for (const s of [SIGMA_MIN, 1]) if (viewPlates(s * 2 ** -LEVEL_HYST, wDev, hDev) <= VIEW_PLATES_MAX) return s;
    return 2 ** 0.5;
}

/** A level plate's key: frame F's picture at Z(ℓ) for step S, cell (i, j). S is in it, so a lever change never serves another step's plate. */
export const levelKey = (F, l, S, i, j) => F + "|L" + l + "s" + S + "|" + i + "," + j;
/** A rest plate's key: frame F at the exact zoom Z (printed exactly), cell (i, j) of the grid at Z. */
export const restKey = (F, Z, i, j) => F + "|R" + Z + "|" + i + "," + j;
/** A drag plane's plate: one layer (`tag`) of frame F at the plane's own zoom Zp, cell (i, j). */
export const planeKey = (F, Zp, tag, i, j) => F + "|P" + Zp + "|" + tag + "|" + i + "," + j;

/**
 * Frame A's plate (i, j) at level ℓ as frame B's plate: `{ level, i, j }`, the same picture to the bit.
 * Up a crossing from child C, cell (ci, cj) of its parent: the parent's level ℓ + 12/S, plate
 * (i + ci·2^(8+ℓS), j + cj·2^(8+ℓS)); down into a child it is the inverse; a lateral neighbour is the two
 * through the common parent (`LevelMap.framePath`, which reads the lattice's current addresses). Null when
 * S does not divide 12, when there is no path, or when ℓ or the mapped level is coarser than the frames'
 * own (ℓS < −8: a plate would straddle the other grid). Indices come back as Numbers, or as BigInts past
 * 2^53; BigInt indices are taken too.
 *
 * @param {{framePath: Function, frame: Function}} lm the lattice (`LevelMap`)
 */
export function mapCell(lm, S, A, l, i, j, B) {
    if (!stepMapsFrames(S) || !Number.isInteger(l)) return null;
    const path = lm.framePath(A, B);
    if (!path) return null;
    const shift = CROSS_OCT / S;
    const lB = l + shift * (path.up.length - path.down.length);
    if (l * S < LEVEL_FLOOR || lB * S < LEVEL_FLOOR) return null;
    const steps = [];                                  // [ci, cj, exponent, sign] per crossing, in path order
    let lv = l;
    for (const id of path.up) {
        const f = lm.frame(id);
        if (!f || !f.cell) return null;
        steps.push(f.cell.i, f.cell.j, OFFSET_OCT + lv * S, 1);
        lv += shift;
    }
    for (const id of path.down) {
        const f = lm.frame(id);
        if (!f || !f.cell) return null;
        lv -= shift;
        steps.push(f.cell.i, f.cell.j, OFFSET_OCT + lv * S, -1);
    }
    if (typeof i === "number" && typeof j === "number") {
        let x = i, y = j, safe = true;
        for (let k = 0; k < steps.length && safe; k += 4) {
            const p = 2 ** steps[k + 2];
            x += steps[k + 3] * steps[k] * p;
            y += steps[k + 3] * steps[k + 1] * p;
            safe = Number.isSafeInteger(x) && Number.isSafeInteger(y);
        }
        if (safe) return { level: lB, i: x, j: y };
    }
    let x = BigInt(i), y = BigInt(j);
    for (let k = 0; k < steps.length; k += 4) {
        const p = BIG_ONE << BigInt(steps[k + 2]), s = BigInt(steps[k + 3]);
        x += s * BigInt(steps[k]) * p;
        y += s * BigInt(steps[k + 1]) * p;
    }
    const small = (v) => (v >= -BIG_SAFE && v <= BIG_SAFE ? Number(v) : v);
    return { level: lB, i: small(x), j: small(y) };
}
// BigInt() calls, not literals: CRA 4's webpack parser and the es2019 worker bundles reject `1n`.
const BIG_ONE = BigInt(1), BIG_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The plate k levels coarser than frame F's plate (i, j) at level ℓ that contains it: `{ frame, level, i,
 * j }` with (i ≫ kS, j ≫ kS) at ℓ − k (floor division). Below F's own floor (ℓS < −8) it steps into the
 * parent frame, whose level ℓ + 12/S is the same picture (`mapCell`), and goes on coarsening there. F is a
 * frame id. Null at the lattice's root, for a start level that is not F's own, or for a step that does not
 * divide 12.
 */
export function coarser(lm, S, F, l, i, j, k) {
    if (!stepMapsFrames(S) || !(k >= 0) || !Number.isInteger(k)) return null;
    const floor = ownFloor(S);
    if (!Number.isInteger(l) || l < floor) return null;
    let frame = F, lv = l, x = i, y = j, left = k;
    for (;;) {
        const n = Math.min(left, lv - floor);
        if (n > 0) { x = floorDiv(x, n * S); y = floorDiv(y, n * S); lv -= n; left -= n; }
        if (left === 0) return { frame, level: lv, i: x, j: y };
        const f = lm.frame(frame);
        if (!f || f.parent == null) return null;
        const m = mapCell(lm, S, frame, lv, x, y, f.parent);
        if (!m) return null;
        frame = f.parent; lv = m.level; x = m.i; y = m.j;
    }
}

/** ⌊v / 2^e⌋ for an integer v, a Number or a BigInt. */
function floorDiv(v, e) {
    return typeof v === "bigint" ? v >> BigInt(e) : Math.floor(v / 2 ** e);
}
