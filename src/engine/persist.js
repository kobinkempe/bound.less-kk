/**
 * persist.js — the real save format (roadmap item 6), superseding the dev-only
 * localStorage snapshot.
 *
 * A drawing file is one JSON document:
 *
 *   {
 *     format:  "boundless-drawing",     // sniffable magic
 *     version: 1,                        // integer; readers reject newer
 *     meta:    { name, createdAt, modifiedAt, app },
 *     camera:  { activeLevel, frame?, inScale, inPanX, inPanY },
 *     crossings: { level: { s, t:{x,y}, grid:{w,h,ox,oy} } }
 *              | { __frames: [ { id, parent, depth, edge:{s,t}, grid } ] },
 *     natives:   { frameId: [ stroke | fill, ... ] },
 *   }
 *
 * Frame keys: a canvas that only ever zoomed keeps integer-depth keys (the
 * "spine" — byte-identical to kobin-1). Once a far pan-then-zoom spawns a local
 * frame (see docs/local-frames-design-bible.md), `crossings` becomes the
 * `{ __frames }` tree and `natives`/`camera.frame` carry string frame ids like
 * "2~1". Both shapes decode; old files (integer-only) are unchanged.
 *
 * The payload shapes (camera/crossings/natives) are exactly what the engine's
 * collaborators serialize (Camera.state / LevelMap.serialize /
 * Document.serializeNatives) — the format is a versioned, validated envelope
 * around them, so the dev-0 byte-compat guarantees keep holding. decode also
 * accepts the legacy dev-0 snapshot ({v:"dev-0", ...}) and migrates it, which
 * is how old autosaves keep loading.
 *
 * Validation philosophy: hard-fail on anything the engine would crash or
 * corrupt on (bad ids, non-finite geometry, unknown object types, a future
 * version), stay lenient about everything else — unknown fields on objects and
 * on the envelope are preserved untouched, so older builds can open files
 * written by newer ones that only ADD fields.
 */

import { validateScaleDef } from "./scaleBar";
import { inDigit, tilePhase } from "./frameLattice";
import {
    validEncodedLoops, encodedLoopsWellFormed, encodedLoopsNeedV2, repairLoops, decodeLoops,
    encodeLoops,
} from "./geometry/arcShape";

export const FORMAT = "boundless-drawing";
// Version 2 (2026-09-05, F43): a shape's loops may carry a CUT LINE record
// (code 2 in `arcShape.encodeLoops` — the line a piece was cut from and the
// positions of its ends on it) or a CUT ARC record (code 3 — the piece's own
// arc, the arc it was cut from and its positions on it). A version-1 reader
// would read either as an arc, so a file that holds one is written as
// version 2 and a version-1 build refuses it with a clear message; a drawing
// with no cut piece in it is still written as version 1 and opens anywhere.
export const VERSION = 2;

// ---- encode ----
// `meta.modifiedAt` is always stamped at encode time; name/createdAt persist.
export function encodeDrawing({ camera, crossings, natives, meta = {} }) {
    const now = new Date().toISOString();
    const decoded = decodeMeta(meta, { lenient: true });
    const outMeta = {
        name: decoded.name,
        createdAt: decoded.createdAt,
        modifiedAt: now,
        app: "bound.less",
    };
    if (decoded.scaleDef) outMeta.scaleDef = decoded.scaleDef;
    if (decoded.scenes) outMeta.scenes = decoded.scenes;
    if (decoded.hiddenScenes) outMeta.hiddenScenes = decoded.hiddenScenes;
    if (decoded.sceneSeq) outMeta.sceneSeq = decoded.sceneSeq;
    // Version 1 unless something in the drawing needs version 2 (a cut line,
    // F43), so an unaffected drawing still opens in any build.
    let version = 1;
    for (const l of Object.keys(natives || {})) {
        for (const o of natives[l] || []) {
            if (o && o.type === "shape" && encodedLoopsNeedV2(o.loops)) { version = VERSION; break; }
        }
        if (version === VERSION) break;
    }
    return {
        format: FORMAT,
        version,
        meta: outMeta,
        camera: {
            activeLevel: camera.activeLevel, inScale: camera.inScale,
            inPanX: camera.inPanX, inPanY: camera.inPanY,
            ...(camera.frame != null ? { frame: camera.frame } : {}),
        },
        crossings: crossings || {},
        natives: natives || {},
    };
}

// ---- decode ----
// Returns { meta, camera, crossings, natives } (validated, ready for the
// engine) or THROWS with a human-readable reason. Accepts kobin-1 files and
// legacy dev-0 snapshots.
export function decodeDrawing(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("not a drawing: expected a JSON object");
    }
    if (raw.format === FORMAT) {
        if (!Number.isInteger(raw.version) || raw.version < 1) {
            throw new Error("not a drawing: missing or invalid version");
        }
        if (raw.version > VERSION) {
            throw new Error(`this drawing was saved by a newer version of bound.less (file v${raw.version}, app reads up to v${VERSION})`);
        }
        return {
            meta: decodeMeta(raw.meta),
            camera: decodeCamera(raw.camera),
            crossings: decodeCrossings(raw.crossings),
            natives: decodeNatives(raw.natives),
        };
    }
    // Legacy dev snapshot (the pre-format localStorage autosave).
    if (raw.v === "dev-0" && raw.natives && typeof raw.natives === "object") {
        return {
            meta: decodeMeta(null),
            camera: decodeCamera(raw.camera),
            crossings: decodeCrossings(raw.crossings),
            natives: decodeNatives(raw.natives),
        };
    }
    throw new Error("not a bound.less drawing (unrecognized format)");
}

function decodeScaleDef(raw, { lenient = false } = {}) {
    if (raw == null) return null;
    const v = validateScaleDef(raw);
    if (!v) {
        if (lenient) return null;
        throw new Error("bad meta: scaleDef is malformed");
    }
    return v;
}

function decodeMeta(m, { lenient = false } = {}) {
    const now = new Date().toISOString();
    const out = {
        name: m && typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 200) : "untitled",
        createdAt: m && typeof m.createdAt === "string" ? m.createdAt : now,
        modifiedAt: m && typeof m.modifiedAt === "string" ? m.modifiedAt : now,
    };
    if (m && m.scaleDef != null) {
        const sd = decodeScaleDef(m.scaleDef, { lenient });
        if (sd) out.scaleDef = sd;
    }
    // Scenes are regenerable, so validation is ALWAYS lenient: malformed
    // entries are dropped silently rather than failing the whole drawing.
    if (m && Array.isArray(m.scenes)) {
        const scenes = m.scenes.filter(validScene).map(cloneScene);
        if (scenes.length) out.scenes = scenes;
    }
    if (m && Array.isArray(m.hiddenScenes)) {
        const hidden = m.hiddenScenes.filter((h) => h && isFrameKey(h.level) && validRect(h.rect))
            .map((h) => ({ level: h.level, rect: cloneRect(h.rect) }));
        if (hidden.length) out.hiddenScenes = hidden;
    }
    if (m && Number.isInteger(m.sceneSeq) && m.sceneSeq > 0) out.sceneSeq = m.sceneSeq;
    return out;
}

function validRect(r) {
    return r && isFiniteNum(r.x) && isFiniteNum(r.y)
        && isFiniteNum(r.w) && r.w > 0 && isFiniteNum(r.h) && r.h > 0;
}
// A frame key: a depth int (the spine, still written that way) or a lattice
// cell path built from one, e.g. "0/12,-3/0,1". The old free-floating sibling
// form ("2~1") cannot occur any more and is not accepted — a scene naming one
// would point at a frame that no document can contain.
function isFrameKey(v) {
    return Number.isInteger(v) || (typeof v === "string" && /^-?\d+(\/-?\d+,-?\d+)*$/.test(v));
}
function validScene(s) {
    return s && typeof s.id === "string" && s.id
        && typeof s.name === "string"
        && isFrameKey(s.level) && validRect(s.rect);
}
function cloneRect(r) { return { x: r.x, y: r.y, w: r.w, h: r.h }; }
function cloneScene(s) {
    return {
        id: s.id.slice(0, 40), name: s.name.slice(0, 120),
        level: s.level, rect: cloneRect(s.rect),
        pinned: !!s.pinned, auto: !!s.auto,
        ...(typeof s.hash === "string" ? { hash: s.hash.slice(0, 20) } : {}),
        ...(Number.isInteger(s.depth) && s.depth >= 0 ? { depth: s.depth } : {}),
        ...(typeof s.parent === "string" && s.parent ? { parent: s.parent.slice(0, 40) } : {}),
        ...(s.captured ? { captured: true } : {}),
    };
}

function decodeCamera(c) {
    if (c == null) return { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 };
    const out = {
        activeLevel: c.activeLevel == null ? 0 : c.activeLevel,
        inScale: c.inScale == null ? 1 : c.inScale,
        inPanX: c.inPanX == null ? 0 : c.inPanX,
        inPanY: c.inPanY == null ? 0 : c.inPanY,
    };
    // Optional frame id (local-frames): a non-empty string identifying the
    // active frame; the engine falls back to the spine at `activeLevel` if absent.
    if (c.frame != null) {
        if (typeof c.frame !== "string" || !c.frame) throw new Error("bad camera: frame must be a non-empty string");
        out.frame = c.frame;
    }
    if (!Number.isInteger(out.activeLevel)) throw new Error("bad camera: activeLevel must be an integer");
    if (!isFiniteNum(out.inScale) || out.inScale <= 0) throw new Error("bad camera: inScale must be a positive number");
    if (!isFiniteNum(out.inPanX) || !isFiniteNum(out.inPanY)) throw new Error("bad camera: pan must be finite");
    return out;
}

// A frame is a LATTICE CELL now, so the whole tree is (id, parent, depth, i, j):
// the edge is derived from the cell index and the grid is a constant. The two
// older shapes — the per-depth {s, t} dict and the free-floating `__frames`
// tree — described frames anchored wherever the camera happened to be when they
// were first crossed into, and no cell index reproduces that. Converting one
// would mean rewriting every stored coordinate, which is precisely the
// operation this design exists to avoid, so a legacy file is REFUSED with a
// clear error and never half-converted (D8).
function decodeCrossings(cr) {
    if (cr == null) return { __lattice: 1, frames: [] };
    if (typeof cr !== "object" || Array.isArray(cr)) throw new Error("bad crossings: expected an object");
    if (!cr.__lattice) {
        if (Array.isArray(cr.__frames) || Object.keys(cr).length) {
            const e = new Error("This drawing was saved in the pre-lattice format and cannot be opened.");
            e.code = "LEGACY_FORMAT";
            throw e;
        }
        return { __lattice: 1, frames: [] };
    }
    if (!Array.isArray(cr.frames)) throw new Error("bad frames: expected a frames array");
    const ids = new Set();
    const outOfRange = [];
    for (const f of cr.frames) {
        if (!f || typeof f.id !== "string" || !f.id) throw new Error("bad frames: each frame needs a string id");
        if (ids.has(f.id)) throw new Error(`bad frames: duplicate frame id ${f.id}`);
        ids.add(f.id);
        if (!Number.isInteger(f.depth)) throw new Error(`bad frames: frame ${f.id} depth must be an integer`);
        if (f.parent != null && typeof f.parent !== "string") throw new Error(`bad frames: frame ${f.id} parent must be a string`);
        if (!Number.isInteger(f.i) || !Number.isInteger(f.j)) throw new Error(`bad frames: frame ${f.id} cell must be integers`);
        // NOT fatal, deliberately. A build before 2026-08-21 could mint a cell
        // just outside the range (`LevelMap.cellChild` — the view centre drifting
        // a few hundred units past the parent's square), and refusing the file
        // here meant the drawing could not be opened AT ALL. The session that
        // produced it ran perfectly well with that address, so loading it is
        // strictly better than losing it. The mint is fixed; this is only about
        // not punishing the files it already wrote.
        if (!inDigit(f.i) || !inDigit(f.j)) outOfRange.push(f.id);
    }
    if (outOfRange.length) cr.__outOfRangeCells = outOfRange;
    return cr;
}

function decodeNatives(n) {
    if (n == null) return { 0: [] };
    if (typeof n !== "object" || Array.isArray(n)) throw new Error("bad natives: expected an object of frames");
    const seen = new Set();
    for (const l of Object.keys(n)) {
        // keys are frame ids: an integer depth (the spine) or a cell path built
        // from one, e.g. "0/12,-3/0,1".
        if (!/^-?\d+(\/-?\d+,-?\d+)*$/.test(l)) throw new Error(`bad natives: frame "${l}" is not a valid frame id`);
        if (!Array.isArray(n[l])) throw new Error(`bad natives: frame ${l} is not an array`);
        // Objects that turn out to be nothing at all are DROPPED here rather
        // than refused — see the shape branch below.
        const survivors = [];
        for (const o of n[l]) {
            if (!o || typeof o !== "object") throw new Error(`bad object at level ${l}: not an object`);
            if (!Number.isInteger(o.id) || o.id < 1) throw new Error(`bad object at level ${l}: id must be a positive integer`);
            if (seen.has(o.id)) throw new Error(`bad natives: duplicate id ${o.id}`);
            seen.add(o.id);
            if (o.z != null && !isFiniteNum(o.z)) throw new Error(`bad object ${o.id}: z must be a number`);
            if (o.editId != null && (!Number.isInteger(o.editId) || o.editId < 1)) throw new Error(`bad object ${o.id}: editId must be a positive integer`);
            if (o.attachRect != null && !validOwnedRect(o.attachRect)) throw new Error(`bad object ${o.id}: attachRect is malformed`);
            // The displacement table (F41/F55, geometry/offsets.js): `[[k, ox,
            // oy], ...]`, k an integer depth below the home — 0 is the home
            // level itself since F55 — the offset two finite numbers.
            // Geometry, like the tile phase: garbage here would silently move
            // the object's picture at every level.
            if (o.below != null) {
                if (!Array.isArray(o.below) || !o.below.every((t) => Array.isArray(t) && t.length === 3
                    && Number.isInteger(t[0]) && t[0] >= 0 && isFiniteNum(t[1]) && isFiniteNum(t[2]))) {
                    throw new Error(`bad object ${o.id}: below (offsets under the home) is malformed`);
                }
            }
            // The object's tile-grid phase (bible D4/6.6) — two numbers inside
            // one frame, which is where a chop and therefore a freeze happens.
            // Garbage is still refused: a phase that is not two finite numbers
            // would silently move every cut on the object.
            //
            // But a phase is MODULAR, and normalising one is exact. A file
            // written before 2026-08-21 can carry a phase of exactly W — the
            // same grid as 0, arrived at by float rounding in `tilePhase` — and
            // rejecting it made the drawing unopenable over a value that means
            // precisely what 0 means.
            if (o.tile != null) {
                if (!(Array.isArray(o.tile) && o.tile.length === 2
                    && isFiniteNum(o.tile[0]) && isFiniteNum(o.tile[1]))) {
                    throw new Error(`bad object ${o.id}: tile phase is malformed`);
                }
                o.tile = [tilePhase(o.tile[0]), tilePhase(o.tile[1])];
            }
            if (o.type === "stroke") {
                if (!validPts(o.pts) || o.pts.length < 1) throw new Error(`bad stroke ${o.id}: pts must be a non-empty array of finite [x,y]`);
                if (!isFiniteNum(o.lwFrame) || o.lwFrame <= 0) throw new Error(`bad stroke ${o.id}: lwFrame must be a positive number`);
            } else if (o.type === "fill") {
                if (!Array.isArray(o.polys) || !o.polys.length || !o.polys.every(validPts)) {
                    throw new Error(`bad fill ${o.id}: polys must be arrays of finite [x,y] rings`);
                }
            } else if (o.type === "shape") {
                // A resolved perimeter: closed chains of arcs and lines, stored
                // as flat number arrays (see arcShape.encodeLoops). Every loop
                // must actually CLOSE — an open one would be painted shut with a
                // straight line across the drawing, which is the single worst
                // failure this geometry has.
                if (!encodedLoopsWellFormed(o.loops)) {
                    throw new Error(`bad shape ${o.id}: loops must be arrays of finite numbers`);
                }
                // Closure is REPAIRED, not refused. An unclosed chain is damage
                // one build of ours could do (arcShape.repairLoops says how),
                // and a drawing that cannot be opened over one such object is a
                // worse outcome than a drawing with one object mended.
                if (!validEncodedLoops(o.loops)) {
                    const fixed = repairLoops(decodeLoops(o.loops), o.w);
                    // Nothing left once the chains are closed and the dust is
                    // dropped: the object was already painting nothing, and
                    // carrying it forward is what made the drawing unopenable.
                    if (!fixed.length) continue;
                    o.loops = encodeLoops(fixed);
                }
            } else {
                throw new Error(`bad object ${o.id}: unknown type "${o && o.type}"`);
            }
            survivors.push(o);
        }
        n[l] = survivors;
    }
    return n;
}

function validPts(pts) {
    return Array.isArray(pts) && pts.every((p) => Array.isArray(p) && isFiniteNum(p[0]) && isFiniteNum(p[1]));
}
function validOwnedRect(r) {
    return r && isFiniteNum(r.x0) && isFiniteNum(r.y0) && isFiniteNum(r.x1) && isFiniteNum(r.y1) &&
        r.x1 > r.x0 && r.y1 > r.y0;
}
function isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }
