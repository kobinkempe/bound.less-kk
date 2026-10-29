/**
 * The beta's cloud storage limit (Kobin 2026-10-29): what one account may keep in Firestore, recycle bin included.
 * Checked before a push writes any part (`cloudPushCanvas2`'s `limit`); a refusal leaves the drawing in this browser.
 */
export const ACCOUNT_BYTES = 200 * 1024 * 1024;

// The owner's account is not limited: a hash of the uid (two FNV-1a passes), not the uid itself.
const OWNERS = ["1dfaca82cb0c965c"];
export function uidKey(uid) {
    const s = String(uid || "");
    let h = 0x811c9dc5, g = 0x01000193;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    for (let i = s.length - 1; i >= 0; i--) { g ^= s.charCodeAt(i); g = Math.imul(g, 0x811c9dc5) >>> 0; }
    return h.toString(16).padStart(8, "0") + g.toString(16).padStart(8, "0");
}
export const limitedAccount = (uid) => !!uid && !OWNERS.includes(uidKey(uid));

/** A listed canvas's stored bytes: a kobin-2 copy's chunks, an lz1 copy's parts (700 KiB at most each), its thumbnails. */
export function storedBytes(m) {
    if (!m) return 0;
    let b = m.format === "kobin-2" ? m.size || 0 : (m.parts || 0) * 700 * 1024;
    for (const t of Object.values(m.thumbs || {})) b += t && typeof t.data === "string" ? t.data.length : 0;
    return b;
}
/** The account's stored bytes over a listing (bin included), less the canvas `exceptId`. */
export const accountBytes = (list, exceptId = null) => (list || []).reduce((a, m) => a + (m.id === exceptId ? 0 : storedBytes(m)), 0);

export class CloudLimit extends Error {
    constructor(bytes, limit = ACCOUNT_BYTES) {
        super("the account's cloud storage is full");
        this.name = "CloudLimit"; this.bytes = bytes; this.limit = limit;
    }
}

export const formatMB = (b) => `${Math.round(b / (1024 * 1024))} MB`;

/** What the user reads when a push is refused (Kobin's wording). */
export function limitMessage(err) {
    return `Your drawings would use ${formatMB(err.bytes)} of cloud storage. Only ${formatMB(err.limit)} are provided `
        + "for free in this beta version — a paid subscription will come in a future release. This drawing is saved in "
        + "your browser's storage for now: download it (⋮ → Download .boundless.json) to keep your work in case your "
        + "browser storage is cleared. Deleting drawings, and emptying them from the recycle bin, frees cloud space.";
}
