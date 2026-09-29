/**
 * legacy/modelV1.js — the inverses of the model before A1's C1, for stores and undo stacks written by
 * it and nothing else (PLAN §5.2 Q6). That model settled a frame's shift into its natives' tables at
 * the first read and carried a native past a cell edge to the neighbour (DESIGN §8 before B-MODEL-C1),
 * and logged each settle as an entry of its result tables, recorded on the move op that placed the
 * frame (`settled`). Replay puts those tables back (`applySettle`, idempotent); the undo of such an op
 * takes them back out (`unsettle`). Imported by the op log's replay and by `Document`'s undo of a
 * `moveFrames` op carrying a `settled` record, nowhere else (`legacy/modelV1.test.js` checks).
 *
 * DELETE ON OR AFTER 2026-12-31: the undo window is 200 ops (`Document` UNDO_CAP) and a store drops
 * entries older than it at its next compaction, so by then no live store or stack holds a settle.
 * First load `hooks/store.model.test.js`'s fixture without this module to confirm.
 */
import { addOffset } from "../geometry/offsets";

/** A replayed settle entry: the tables and homes it recorded, set as they are (idempotent). */
export function applySettle(doc, frameId, rec) {
    const homes = new Map(rec.carries || []);
    for (const [id, after] of rec.tables) {
        const r = doc.getById(id);
        if (!r) continue;
        const to = homes.get(id);
        if (to != null && r.level !== String(to)) doc.rehomeById(id, to);
        doc.setOffsetsById(id, after || undefined);
    }
}

/** The inverse of a recorded settle, from its result tables (idempotent); a native it carried comes home by id. */
export function unsettle(doc, frameId, settled) {
    const k = String(frameId);
    for (const [id, after] of settled.tables) {
        const r = doc.getById(id);
        if (!r) continue;
        if (r.level !== k) doc.rehomeById(id, k);
        doc.setOffsetsById(id, addOffset(after, 0, -settled.dx, -settled.dy).below);
    }
}
