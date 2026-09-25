/**
 * sceneWorkerClient.js — the scene index off the main thread (SCENES-PLAN §7.2).
 *
 * The index is state, so each scene client owns one worker (`public/scene-worker.js`, built from
 * worker/sceneWorker.js by `npm run build:worker`) and posts one batch at a time. Where there is no
 * Worker or the script fails, `openSceneWorker` returns null and the client runs the index inline —
 * jsdom always does. A test can stand in a transport with `setSceneTransport`.
 */
let broken = false;
let transport = null;   // () => { post(batch) -> Promise<out>, terminate() }; tests only

export function setSceneTransport(t) { transport = t || null; }

function workerUrl() {
    const base = (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL) || "";
    return base + "/scene-worker.js";
}

/** A handle `{post(batch) -> Promise<out>, terminate()}` on a fresh worker, or null where there is none. */
export function openSceneWorker() {
    if (transport) return transport();
    if (broken || typeof Worker === "undefined") return null;
    let w;
    try { w = new Worker(workerUrl()); } catch (err) { broken = true; return null; }
    let seq = 0, answered = false;
    const pending = new Map();
    const fail = (why) => {
        const all = [...pending.values()];
        pending.clear();
        for (const p of all) p.reject(new Error(why));
    };
    w.onmessage = (e) => {
        const { id, ok, out, err } = e.data || {};
        answered = true;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (ok) p.resolve(out); else p.reject(new Error(err || "scene worker failed"));
    };
    w.onerror = (e) => {
        // Never answered: the script did not load, and no worker will (the clients go inline). After
        // an answer the worker itself failed, and the client may open another (SC-3).
        if (!answered) broken = true;
        try { w.terminate(); } catch (err) { /* ignore */ }
        fail("scene worker unavailable");
        if (e && e.preventDefault) e.preventDefault();
    };
    return {
        post(batch) {
            return new Promise((resolve, reject) => {
                const id = ++seq;
                pending.set(id, { resolve, reject });
                try { w.postMessage({ id, batch }); } catch (err) { pending.delete(id); reject(err); }
            });
        },
        terminate() { try { w.terminate(); } catch (err) { /* ignore */ } fail("terminated"); },
    };
}
