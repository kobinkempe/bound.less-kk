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

    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_W}px;height:${THUMB_H}px;overflow:hidden;`;
    document.body.appendChild(host);
    const out = {};
    let engine = null;
    try {
        engine = new KobinEngine(host, { width: THUMB_W, height: THUMB_H });
        engine.setLazyOutlines(false); // render final representations now
        engine.loadDrawing(JSON.parse(JSON.stringify(doc)));
        for (const s of todo) {
            if (!engine.jumpTo(s.level, aspectRect(s.rect))) continue;
            const svg = host.querySelector("svg");
            if (!svg) continue;
            const data = await rasterize(svg);
            if (data) out[s.id] = { hash: s.hash || "", data };
        }
    } catch (err) {
        console.warn("thumbnail render failed", err);
    } finally {
        try { if (engine) engine.destroy(); } catch (err) { /* ignore */ }
        host.remove();
    }
    return out;
}
