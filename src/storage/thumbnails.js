/**
 * Offscreen scene thumbnails — an engine render of each scene's frame,
 * rasterized to a small JPEG data URL. Browser-only (Image/canvas); nothing
 * in the jsdom test suite imports this module.
 *
 * Thumbs are cached by the scene's content hash: renderThumbs() only
 * re-renders scenes whose hash differs from what's stored.
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

function rasterize(svgEl) {
    return new Promise((resolve) => {
        try {
            const clone = svgEl.cloneNode(true);
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            clone.setAttribute("width", String(THUMB_W));
            clone.setAttribute("height", String(THUMB_H));
            const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = THUMB_W; canvas.height = THUMB_H;
                    const ctx = canvas.getContext("2d");
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
                    ctx.drawImage(img, 0, 0, THUMB_W, THUMB_H);
                    resolve(canvas.toDataURL("image/jpeg", 0.8));
                } catch (err) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = src;
        } catch (err) { resolve(null); }
    });
}

/**
 * A ONE-OFF SVG engine over a document copy, off screen, for `fn(engine, host)`; destroyed
 * after. §5.7, explicitly: a thumbnail or an export is made by SERIALISING the engine's `<svg>`,
 * and the raster path draws the ink into a canvas no serialiser can see — so this engine is the
 * SVG one whatever the tab's own renderer is, written out because a picture that silently went
 * blank would look like a document that had lost its ink. The document is loaded, so the copy's
 * camera is the file's: an export at the live camera serialises the live view.
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
        return await fn(engine, host);
    } finally {
        try { if (engine) engine.destroy(); } catch (err) { /* ignore */ }
        host.remove();
    }
}

/**
 * Thumbnails from the LIVE raster engine (SCENES-PLAN S2): one `snapshotView` a scene, at most
 * `limit` in flight, each scaled to 320×240 on a small canvas; `onThumb` fires as each lands so
 * the panel fills progressively. Scenes the engine cannot snapshot — raster off, an unreachable
 * frame, no canvas context — come back in `missed` for the old path. A cold frame's tile bake
 * still runs inside `snapshotView` on the main thread (F59); the jobs are spaced by an idle
 * callback so the panel stays responsive between them.
 * @returns {Promise<{out:object, missed:object[]}>} `out` in `renderThumbs`'s shape
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

/**
 * Render thumbnails for every scene whose hash isn't already cached.
 * `doc`: a kobin-1 document; `existing`: { sceneId: { hash, data } }.
 * Returns only the NEW entries (same shape).
 */
export async function renderThumbs(doc, scenes, existing = {}) {
    const todo = scenes.filter((s) => {
        const have = existing[s.id];
        return !have || !s.hash || have.hash !== s.hash;
    });
    if (!todo.length) return {};
    const out = {};
    try {
        await withSvgEngine(doc, THUMB_W, THUMB_H, async (engine, host) => {
            for (const s of todo) {
                if (!engine.jumpTo(s.level, aspectRect(s.rect))) continue;
                const svg = host.querySelector("svg");
                if (!svg) continue;
                const data = await rasterize(svg);
                if (data) out[s.id] = { hash: s.hash || "", data };
            }
        });
    } catch (err) {
        console.warn("thumbnail render failed", err);
    }
    return out;
}
