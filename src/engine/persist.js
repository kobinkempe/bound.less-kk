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
 *     camera:  { activeLevel, inScale, inPanX, inPanY },
 *     crossings: { level: { s, t:{x,y}, grid:{w,h,ox,oy} } },
 *     natives:   { level: [ stroke | fill, ... ] },
 *   }
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

export const FORMAT = "boundless-drawing";
export const VERSION = 1;

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
    return {
        format: FORMAT,
        version: VERSION,
        meta: outMeta,
        camera: {
            activeLevel: camera.activeLevel, inScale: camera.inScale,
            inPanX: camera.inPanX, inPanY: camera.inPanY,
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
    return out;
}

function decodeCamera(c) {
    if (c == null) return { activeLevel: 0, inScale: 1, inPanX: 0, inPanY: 0 };
    const out = {
        activeLevel: c.activeLevel == null ? 0 : c.activeLevel,
        inScale: c.inScale == null ? 1 : c.inScale,
        inPanX: c.inPanX == null ? 0 : c.inPanX,
        inPanY: c.inPanY == null ? 0 : c.inPanY,
    };
    if (!Number.isInteger(out.activeLevel)) throw new Error("bad camera: activeLevel must be an integer");
    if (!isFiniteNum(out.inScale) || out.inScale <= 0) throw new Error("bad camera: inScale must be a positive number");
    if (!isFiniteNum(out.inPanX) || !isFiniteNum(out.inPanY)) throw new Error("bad camera: pan must be finite");
    return out;
}

function decodeCrossings(cr) {
    if (cr == null) return {};
    if (typeof cr !== "object" || Array.isArray(cr)) throw new Error("bad crossings: expected an object");
    for (const l of Object.keys(cr)) {
        if (!Number.isInteger(+l)) throw new Error(`bad crossings: level "${l}" is not an integer`);
        const r = cr[l];
        if (!r || !isFiniteNum(r.s) || r.s <= 0 || !r.t || !isFiniteNum(r.t.x) || !isFiniteNum(r.t.y)) {
            throw new Error(`bad crossings: level ${l} record needs finite s > 0 and t.{x,y}`);
        }
        // grid is optional (LevelMap derives one), but if present must be sane
        if (r.grid && !(isFiniteNum(r.grid.w) && r.grid.w > 0 && isFiniteNum(r.grid.h) && r.grid.h > 0 &&
            isFiniteNum(r.grid.ox) && isFiniteNum(r.grid.oy))) {
            throw new Error(`bad crossings: level ${l} grid is malformed`);
        }
    }
    return cr;
}

function decodeNatives(n) {
    if (n == null) return { 0: [] };
    if (typeof n !== "object" || Array.isArray(n)) throw new Error("bad natives: expected an object of levels");
    const seen = new Set();
    for (const l of Object.keys(n)) {
        if (!Number.isInteger(+l)) throw new Error(`bad natives: level "${l}" is not an integer`);
        if (!Array.isArray(n[l])) throw new Error(`bad natives: level ${l} is not an array`);
        for (const o of n[l]) {
            if (!o || typeof o !== "object") throw new Error(`bad object at level ${l}: not an object`);
            if (!Number.isInteger(o.id) || o.id < 1) throw new Error(`bad object at level ${l}: id must be a positive integer`);
            if (seen.has(o.id)) throw new Error(`bad natives: duplicate id ${o.id}`);
            seen.add(o.id);
            if (o.z != null && !isFiniteNum(o.z)) throw new Error(`bad object ${o.id}: z must be a number`);
            if (o.type === "stroke") {
                if (!validPts(o.pts) || o.pts.length < 1) throw new Error(`bad stroke ${o.id}: pts must be a non-empty array of finite [x,y]`);
                if (!isFiniteNum(o.lwFrame) || o.lwFrame <= 0) throw new Error(`bad stroke ${o.id}: lwFrame must be a positive number`);
            } else if (o.type === "fill") {
                if (!Array.isArray(o.polys) || !o.polys.length || !o.polys.every(validPts)) {
                    throw new Error(`bad fill ${o.id}: polys must be arrays of finite [x,y] rings`);
                }
            } else {
                throw new Error(`bad object ${o.id}: unknown type "${o && o.type}"`);
            }
        }
    }
    return n;
}

function validPts(pts) {
    return Array.isArray(pts) && pts.every((p) => Array.isArray(p) && isFiniteNum(p[0]) && isFiniteNum(p[1]));
}
function isFiniteNum(v) { return typeof v === "number" && Number.isFinite(v); }
