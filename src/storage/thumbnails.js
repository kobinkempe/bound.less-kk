/**
 * Scene thumbnails from the live engine (`renderThumbsLive`), and the one-off SVG engine the .svg
 * export serialises (`withSvgEngine`, which runs in jsdom: `thumbnails.test.js`). Thumbs are cached
 * by the scene's content hash: only scenes whose hash differs from what's stored are rendered.
 */
import KobinEngine from "../engine/KobinEngine";

export const THUMB_W = 320;
export const THUMB_H = 240;

/** Expand a scene rect to the thumbnail aspect, centered. */
function aspectRect(rect) {
    const target = THUMB_W / THUMB_H;
    let { x, y, w, h } = rect;
    if (w / h < target) { const nw = h * target; x -= (nw - w) / 2; w = nw; }
    else { const nh = w / target; y -= (nh - h) / 2; h = nh; }
    return { x, y, w, h };
}

/**
 * A ONE-OFF SVG engine over a document copy, off screen, for `fn(engine, host)`; destroyed after.
 * The export is made by serialising this engine's `<svg>` (the page's raster engine draws into a
 * canvas no serialiser can see). The document is loaded, so the copy's camera is the file's. The
 * erase barrier runs first (`flushErases`): no pending mark reaches the export (PLAN §5.8 item 2).
 */
export async function withSvgEngine(doc, w, h, fn) {
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;overflow:hidden;`;
    document.body.appendChild(host);
    let engine = null;
    try {
        engine = new KobinEngine(host, { width: w, height: h, raster: false, scenes: false });
        engine.setLazyOutlines(false); // render final representations now
        engine.loadDrawing(JSON.parse(JSON.stringify(doc)));
        engine.flushErases();
        return await fn(engine, host);
    } finally {
        try { if (engine) engine.destroy(); } catch (err) { /* ignore */ }
        host.remove();
    }
}

/**
 * Thumbnails from the LIVE raster engine (SCENES-PLAN S2): one `snapshotView` a scene, at most
 * `limit` in flight, each scaled to 320×240 on a small canvas; `onThumb` fires as each lands so
 * the panel fills progressively. Scenes the engine cannot snapshot — not a raster engine, an
 * unreachable frame, no canvas context — come back in `missed` (they keep their last picture). A
 * cold frame's tile bake still runs inside `snapshotView` on the main thread (F59); the jobs are
 * spaced by an idle callback so the panel stays responsive between them.
 * @returns {Promise<{out:object, missed:object[]}>} `out`: { sceneId: { hash, data } }
 */
export async function renderThumbsLive(engine, scenes, existing = {}, opts = {}) {
    const todo = scenes.filter((s) => { const have = existing[s.id]; return !have || !s.hash || have.hash !== s.hash; });
    const out = {}, missed = [];
    if (!todo.length) return { out, missed };
    if (!engine || !engine.raster || typeof engine.snapshotView !== "function") return { out, missed: todo };
    const limit = opts.limit > 0 ? opts.limit : 4;
    const signal = opts.signal || null;
    const idle = () => new Promise((r) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 200 }) : setTimeout(r, 30)));
    let at = 0;
    const one = async (s) => {
        if (signal && signal.aborted) return;
        await idle();
        if (signal && signal.aborted) return;
        let bitmap = null;
        try { bitmap = await engine.snapshotView({ frame: s.level, rect: aspectRect(s.rect), w: THUMB_W, h: THUMB_H, signal }); } catch (err) { bitmap = null; }
        if (!bitmap) { missed.push(s); return; }
        const data = scaleToDataUrl(bitmap, THUMB_W, THUMB_H);
        if (bitmap.close) { try { bitmap.close(); } catch (err) { /* already closed */ } }
        if (!data) { missed.push(s); return; }
        out[s.id] = { hash: s.hash || "", data };
        if (opts.onThumb) opts.onThumb(s.id, out[s.id]);
    };
    const lane = async () => { while (at < todo.length) { const s = todo[at++]; await one(s); } };
    const lanes = [];
    for (let k = 0; k < Math.min(limit, todo.length); k++) lanes.push(lane());
    await Promise.all(lanes);
    return { out, missed };
}

/** The plate's top-left w×h — where `fitView` put the rect (P3) — to a JPEG data URL; null without a context. */
function scaleToDataUrl(bitmap, w, h) {
    try {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h, 0, 0, w, h);
        return canvas.toDataURL("image/jpeg", 0.8);
    } catch (err) { return null; }
}
