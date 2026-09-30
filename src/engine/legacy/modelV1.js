/**
 * legacy/modelV1.js — the inverses of the model before A1's C1 and C3, for stores and undo stacks written
 * by it and nothing else (PLAN §5.2 Q6). That model settled a frame's shift into its natives' tables at
 * the first read and carried a native past a cell edge to the neighbour (DESIGN §8 before B-MODEL-C1),
 * and logged each settle as an entry of its result tables, recorded on the move op that placed the
 * frame (`settled`). Replay puts those tables back (`applySettle`, idempotent); the undo of such an op
 * takes them back out (`unsettle`). Until C3 a frame moved onto an occupied cell merged into its resident
 * at the action's end (a `mergeFrame` entry, a `merged` record on the move op): replay moves the natives
 * as recorded (`mergeReplay`, `unmergeReplay`), and the undo of such an op puts the frame back as its
 * resident's co-resident (`unmerge`). Imported by the op log's replay and by `Document`'s undo of a
 * `moveFrames` op carrying a `settled` or `merged` record, nowhere else (`legacy/modelV1.test.js` checks).
 *
 * DELETE ON OR AFTER 2026-12-31: the undo window is 200 ops (`Document` UNDO_CAP) and a store drops
 * entries older than it at its next compaction, so by then no live store or stack holds a settle.
 * First load `hooks/store.model.test.js`'s fixture without this module to confirm.
 */
import { addOffset, decodeBelow } from "../geometry/offsets";

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

/** A merge record from the file, copied so the op and the entry never share it; `tables` `[id, before, after]`. */
export function mergeLive(rec) {
    const out = JSON.parse(JSON.stringify({ id: rec.id, into: rec.into, parent: rec.parent, i: rec.i, j: rec.j, depth: rec.depth, addrSeq: rec.addrSeq || 0,
        shift: rec.shift || null, shadows: rec.shadows || [], kids: rec.kids || [], ids: rec.ids || [] }));
    if (rec.tables) out.tables = rec.tables.map(([id, b, a]) => [id, decodeBelow(b) || null, decodeBelow(a) || null]);
    return out;
}

function setTables(doc, tables, which) {
    for (const t of tables || []) if (doc.getById(t[0])) doc.setOffsetsById(t[0], t[which] || undefined);
}

/** A replayed `mergeFrame` entry: the frame's natives into its resident's list, their tables as recorded (idempotent). */
export function mergeReplay(doc, rec) { doc.rehomeManyById(rec.ids, rec.into); setTables(doc, rec.tables, 2); doc._forgetIfEmpty(rec.id); }

/** A replayed undo of one: the natives back in the frame's list (the header holds the frame). */
export function unmergeReplay(doc, rec) { doc.rehomeManyById(rec.ids, rec.id); setTables(doc, rec.tables, 1); doc._forgetIfEmpty(rec.into); }

/** The live undo of a recorded merge: the frame back at its cell as a co-resident, its kids and natives back in it. */
export function unmerge(doc, rec) {
    const lm = doc.lm;
    if (!lm.frame(rec.id)) lm.restoreFrame({ id: rec.id, parent: rec.parent, i: rec.i, j: rec.j, depth: rec.depth, shift: rec.shift, addrSeq: (rec.addrSeq || 0) + 1 });
    for (let n = rec.kids.length - 1; n >= 0; n--) lm.reparent(rec.kids[n].id, rec.id);
    unmergeReplay(doc, rec);
}
