/**
 * A stored kobin-2 canvas as ONE kobin-1 document (F86): its frame snapshots, plus its log tail —
 * the entries a snapshot does not hold yet — replayed through a detached engine the way the editor
 * loads it (`useKobinEngine` restoreFrom). Without a tail the frames are the document, and no
 * engine is made.
 */
import KobinEngine from "../engine/KobinEngine";
import { OpLog, snapshotRule } from "../engine/oplog";
import { decodeObjects } from "../engine/format2";

/** The entries the snapshots do not hold: replay's rule (`snapshotRule`) inverted. */
export function logTail(entries, frameSeq = {}, listed = null) {
    const held = snapshotRule(frameSeq, listed);
    return (entries || []).filter((e) => !held(e.seq, e.touches || []));
}

// A frame as kobin-1 records with PLAIN arrays: a decoded loop is a view of the frame's geometry.
export function plainRecords(objects, geo) {
    return decodeObjects(objects, geo).map((r) => (r.loops ? { ...r, loops: r.loops.map((l) => Array.from(l)) } : r));
}

/**
 * `{ legacy }` or `{ header, frames: { id: { objects, geo, seq } }, entries }` (a load or a pull) → a
 * kobin-1 document, or null. A log that will not replay gives the snapshots alone, with a warning:
 * the download is the way out for exactly such a canvas.
 */
export function docFromStore(res) {
    if (!res) return null;
    if (res.legacy) return res.legacy;
    const { header, frames, entries } = res;
    const { store, frameIds, frameSeq, seq, id, name, savedAt, base, intent, pending, writer, ...envelope } = header;
    const snapshots = () => {
        const natives = {};
        for (const [fid, f] of Object.entries(frames)) natives[fid] = plainRecords(f.objects, f.geo);
        return { format: envelope.format, version: envelope.version, meta: envelope.meta, camera: envelope.camera, crossings: envelope.crossings, natives };
    };
    if (!logTail(entries, frameSeq || {}, frameIds).length) return snapshots();
    const natives = {};
    for (const [fid, f] of Object.entries(frames)) natives[fid] = decodeObjects(f.objects, f.geo);
    let E = null;
    try {
        E = new KobinEngine(document.createElement("div"), { width: 1024, height: 768, scenes: false });
        E.loadDrawing({ ...envelope, natives }, { render: false });   // nothing is shown: a cold render is seconds (F87)
        new OpLog(E).replay(entries, { ...(frameSeq || {}) }, frameIds);
        return E.serializeDrawing();
    } catch (err) {
        console.warn("the canvas's log will not replay; its snapshots alone are returned", err);
        return snapshots();
    } finally { if (E) E.destroy(); }
}
