/**
 * syncCore.js — the pure rules of one canvas on several tabs and devices (SYNC-PLAN R1–R5).
 * No Firestore, no IndexedDB, no engine: canvasSync.js and canvasSession.js call these.
 *
 * A canvas's history has a HEAD `{ epoch, seq }`: `seq` is the op log's, `epoch` changes each
 * time a different device or tab takes the pen. The cloud manifest carries `head`; the local
 * header carries `base`, the cloud head it last pulled or pushed (and the collection it came
 * from). Every decision compares versions; `savedAt` is for display, except once, for a pair
 * that predates versions (`decideOpen`'s unknown-ancestry branch).
 */

export const LEASE_TTL_MS = 90 * 1000;      // a lease not renewed for this long is free
export const LEASE_BEAT_MS = 20 * 1000;     // the holder renews this often while visible
// A lease's `until` is the HOLDER's clock: another device treats it as dead unasked only this long
// past it, so a clock running ahead cannot take a live lease (a follower watching it go stale on
// its own clock takes it sooner, canvasSession._maybeTake).
export const LEASE_SKEW_MS = 5 * 60 * 1000;

/** A fresh epoch: short, random, safe in a Firestore document id. Legacy copies are epoch 0. */
export function newEpoch() {
    return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

/** The head of a cloud manifest; a manifest from before versions reads as epoch 0 at its seq. */
export function headOf(manifest) {
    if (!manifest) return null;
    const h = manifest.head;
    if (h && h.seq != null) return { epoch: h.epoch == null ? 0 : h.epoch, seq: h.seq || 0 };
    return { epoch: 0, seq: manifest.seq || 0 };
}

export function sameHead(a, b) {
    return !!a && !!b && String(a.epoch) === String(b.epoch) && (a.seq || 0) === (b.seq || 0);
}

/**
 * Who may take the pen unasked, read from a manifest's `lease` at `now` (this device's clock):
 * `{ free, mine, holder }`. A lease let go (`until` 0) is free, or only for `to` when it was let
 * go to an asker — the device that let it go included; this device's own live lease is free (the
 * device lock arbitrates its tabs); another's is free only `skewMs` past its `until`.
 */
export function leaseState(lease, { device, now = Date.now(), skewMs = LEASE_SKEW_MS }) {
    if (!lease || !lease.device) return { free: true, mine: false, holder: null };
    if (!(lease.until > 0)) return lease.to && lease.to !== device ? { free: false, mine: false, holder: lease, reserved: true } : { free: true, mine: lease.device === device, holder: null };
    if (lease.device === device) return { free: true, mine: true, holder: lease };
    if (now > lease.until + skewMs) return { free: true, mine: false, holder: null };
    return { free: false, mine: false, holder: lease };
}
// Every chunk a manifest names.
function chunkNames(m) {
    const out = new Set();
    for (const f of Object.values((m && m.frames) || {})) out.add(f.chunk);
    for (const c of (m && m.log) || []) out.add(c.chunk);
    return out;
}
/**
 * A push this device made whose manifest landed though its tab closed before recording it: the
 * cloud head is its intent, or the manifest still names one of its chunks (another device has
 * pushed on top since). The recovered base is the intent.
 */
export function intentLanded(intent, manifest, col) {
    if (!intent || intent.col !== col || !manifest) return false;
    if (sameHead(intent, headOf(manifest))) return true;
    const named = chunkNames(manifest);
    return (intent.chunks || []).some((c) => named.has(c));
}

/**
 * The open decision (R4). `local`: the stored header or null; `cloud`: the manifest or null;
 * `col`: the collection this build syncs with. Returns `{ action, base, why }`:
 *   none      no cloud copy (the first push creates it)
 *   legacy    an lz1 copy: the old freshest-wins pull applies, then the first push replaces it
 *   sync      in step
 *   push      this device has ops past the cloud head (fast-forward push)
 *   pull      the cloud moved and this device has nothing unpushed (fast-forward pull;
 *             `full` when there is no local lineage to build on)
 *   stash     unknown ancestry, cloud newer: pull whole, the local copy to the recycle bin
 *   conflict  both moved: the local copy becomes a new canvas, the cloud copy stays this one
 * `base` is the local base to use from here (it can be recovered: a torn push's intent, a
 * legacy copy this device pushed).
 */
export function decideOpen({ local, cloud, deviceId, col }) {
    if (!cloud) return { action: "none", base: local && local.base && local.base.col === col ? local.base : null, why: "no cloud copy" };
    if (cloud.format !== "kobin-2") return { action: "legacy", base: null, why: "an lz1 cloud copy" };
    const head = { ...headOf(cloud), col };
    if (!local) return { action: "pull", full: true, base: null, why: "no local copy" };
    const kobin2 = local.store === "kobin-2";
    let base = kobin2 && local.base && local.base.col === col ? local.base : null;
    // A push whose manifest landed but whose tab died before recording it: the intent says so.
    if (kobin2 && intentLanded(local.intent, cloud, col)) base = { epoch: local.intent.epoch, seq: local.intent.seq || 0, col };
    const seq = kobin2 ? local.seq || 0 : 0;
    if (!base) {
        if (!(local.strokes > 0)) return { action: "pull", full: true, base: null, why: "the local copy is empty" };
        if (!cloud.head && cloud.device && cloud.device === deviceId) base = { epoch: 0, seq: cloud.seq || 0, col };
        else if (kobin2 && sameFrames(local, cloud) && seq === head.seq) base = head;
        else {
            // Predates versions and the ancestry is unknown: the one time a clock decides, and
            // both answers keep both copies (the recycle bin, or a new canvas).
            const cloudAt = String(cloud.savedAt || ""), localAt = String(local.savedAt || "");
            if (cloudAt > localAt || !kobin2) return { action: "stash", full: true, base: null, why: "unknown ancestry, the cloud copy is newer" };
            return { action: "conflict", base: null, why: "unknown ancestry, this copy is newer" };
        }
    }
    const ahead = seq > (base.seq || 0);
    const moved = !sameHead(head, base);
    if (!ahead && !moved) return { action: "sync", base, why: "in step" };
    if (ahead && !moved) return { action: "push", base, why: "this device is ahead" };
    if (!ahead && moved) return { action: "pull", full: false, base, why: "the cloud moved" };
    return { action: "conflict", base, why: "both moved" };
}

// The same frame set at the same snapshot seqs: a local copy pulled from this manifest.
function sameFrames(local, cloud) {
    const lf = local.frameSeq || {}, cf = cloud.frames || {};
    const lk = Object.keys(lf), ck = Object.keys(cf);
    if (lk.length !== ck.length) return false;
    for (const k of lk) if (!cf[k] || (cf[k].seq || 0) !== (lf[k] || 0)) return false;
    return true;
}

/** "Magnum Opus — edits from Chrome on Windows, Sep 22": the name of a conflict's copy (R5). */
export function conflictName(name, deviceName, at = new Date()) {
    let day = "";
    try { day = at.toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (err) { day = at.toISOString().slice(0, 10); }
    return `${name || "Untitled canvas"} — edits from ${deviceName || "another device"}, ${day}`;
}

/** The default device name (R9): the browser and the OS, from the user agent. */
export function defaultDeviceName(ua = typeof navigator !== "undefined" ? navigator.userAgent : "") {
    const s = String(ua || "");
    const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox"
        : /CriOS|Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Browser";
    const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android"
        : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "Mac" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "";
    return os ? `${browser} on ${os}` : browser;
}
