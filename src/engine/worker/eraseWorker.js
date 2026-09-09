/* eslint-env worker */
/* eslint-disable no-restricted-globals */
/**
 * The erase worker's entry (bundled to public/erase-worker.js by `npm run build:worker`).
 * One message is one cut: the job's loops arrive as transferred buffers, `cutJob` runs
 * the same geometry the main thread would, and the result's regions go back the same
 * way. Nothing here knows about a document.
 */
import "../../polyfills";
import { cutJob, unwireJob, wireResult } from "../eraseJob";
import { descentJob, unwireDescent, wireDescentResult } from "../eraseDescent";

self.onmessage = (e) => {
    const { id, kind, job } = e.data || {};
    try {
        let out;
        if (kind === "descent") { const { world, input } = unwireDescent(job); out = wireDescentResult(descentJob(world, input)); }
        else out = wireResult(cutJob(unwireJob(job)));
        self.postMessage({ id, ok: true, out: out.msg }, out.transfer);
    } catch (err) {
        self.postMessage({ id, ok: false, err: String((err && err.message) || err) });
    }
};
