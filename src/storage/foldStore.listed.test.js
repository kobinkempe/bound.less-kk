/**
 * foldStore's log tail takes replay's rule (F98): an entry that touches only frames the header does
 * not list is held by the snapshots, so a download need not replay it.
 */
import { logTail } from "./foldStore";

test("an entry touching only an unlisted frame is no tail", () => {
    const entries = [{ seq: 4, touches: ["gone"] }, { seq: 5, touches: ["0"] }, { seq: 2, touches: ["0"] }];
    expect(logTail(entries, { 0: 3 }, ["0"]).map((e) => e.seq)).toEqual([5]);   // red: 4 read as a tail
    expect(logTail(entries, { 0: 3 }).map((e) => e.seq)).toEqual([4, 5]);        // without the frame set, as before
});
