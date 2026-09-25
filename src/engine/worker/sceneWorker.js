/* eslint-env worker */
/* eslint-disable no-restricted-globals */
/**
 * The scene worker's entry (bundled to public/scene-worker.js by `npm run build:worker`). It holds
 * one scene index; each message is one batch (sceneIndex.apply), answered with the scene list and
 * the saved state. Nothing here knows about a document.
 */
import "../../polyfills";
import { SceneIndex } from "../sceneIndex";

const index = new SceneIndex();
index.autoCompact = false;   // compacted after the result is posted, off the batch's time

self.onmessage = (e) => {
    const { id, batch } = e.data || {};
    try {
        const out = index.apply(batch || {});
        self.postMessage({ id, ok: true, out });
        index.compact();
    } catch (err) {
        self.postMessage({ id, ok: false, err: String((err && err.message) || err) });
    }
};
