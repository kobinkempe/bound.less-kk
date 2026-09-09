/**
 * zorder-compact.js — relabel every object's z as its rank in the current paint order.
 *
 * Document-only repair for a canvas whose stored z values put new ink underneath
 * (OPEN-FLAGS F63: one canvas carried z = depth * 1e7 + id, so a new stroke, whose z
 * is its id, sorted under everything). The picture does not change: objects are sorted
 * exactly as the renderer paints them (z, then id) and numbered 1..N. Ids are untouched.
 * A new object's z is its id, and ids continue above N, so new ink lands on top.
 *
 * Run it in the browser on the open canvas (dev build, or `?dev` on the URL): paste into
 * the console, or eval it through the Claude in Chrome extension. It POSTs a backup of
 * every object's old z to the report server (tools/report-server.js, :3001) when that is
 * running, then emits one `change` event per frame so the autosave writes every frame
 * and the cloud sync follows within 30 s. Nothing here touches the erase bake.
 */
(async () => {
    const E = window.__kobinEngine;
    if (!E) throw new Error("no engine on this page (dev build or ?dev needed)");
    const zOf = (o) => (o.z != null ? o.z : o.id);
    const rows = [];
    for (const k of E.doc.levels()) for (const o of E.doc.at(k)) rows.push({ o, level: k });

    const backup = {
        kind: "zorder-backup", canvas: location.hash, when: new Date().toISOString(),
        rows: rows.map(({ o, level }) => [o.id, level.split("/").length - 1, o.z == null ? null : o.z]),
    };
    let backedUp = false;
    try {
        const r = await fetch("http://localhost:3001/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(backup) });
        backedUp = r.ok;
    } catch (err) { /* report server not running: proceed without a backup */ }

    rows.sort((a, b) => (zOf(a.o) - zOf(b.o)) || (a.o.id - b.o.id));
    let changed = 0;
    rows.forEach(({ o }, i) => { const z = i + 1; if (o.z !== z) { o.z = z; changed++; } });

    // Every frame dirty: the tile store ignores an event without `obj`, the autosave does not.
    const levels = [...E.doc.levels()];
    for (const k of levels) E.doc._emit({ kind: "change", level: k, zRelabel: true });
    return { objects: rows.length, changed, maxZ: rows.length, nextId: E.doc._nextId, frames: levels.length, backedUp };
})();
