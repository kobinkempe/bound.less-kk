/**
 * eraseWorkerClient.js — cuts and descents in the shared pool (PLAN §1.6, A3 §4.1): one job of kind "cut" at
 * `PRIO.cut` through a `JobQueue` — the renderer's, where plates and cuts share it, or `cutQueue()`'s on the SVG
 * path — posted to a raster worker, which runs `cutJob` or `descentJob` (`worker/rasterWorker.js`'s `runCut`).
 * While any cut is pending the queue keeps one worker for cuts (`JobQueue._best`).
 *
 * `submit(queue, {kind, barrier, job})` returns a promise of the result, or null when the pool is broken (jsdom, a
 * script that did not load, a pool past its respawns): the caller runs the job inline. A lost job (PLAN §5.9 item
 * 1): lost to a worker's error, it goes back to the head of its priority once (`requeue`); the one the watchdog
 * found silent, a second loss, or a job that threw in the worker rejects with `err.why`, and the caller refuses the
 * pair over ink (A2 §5.7) — never inline, where the same job would stall the page.
 */
import { wireJob, unwireResult } from "./eraseJob";
import { wireDescent, unwireDescentResult } from "./eraseDescent";
import JobQueue, { PRIO } from "./raster/jobQueue";
import { rasterPool, poolBroken } from "./raster/rasterWorkerClient";

const stats = { jobs: 0, inline: 0, landed: 0, requeued: 0, lost: 0 };

/** A queue over the pool for cuts alone: the SVG renderer has none of its own. */
export function cutQueue() {
    return new JobQueue({ pool: { size: () => rasterPool.size(), free: () => rasterPool.free(), submit: (st) => rasterPool.submit(st.entry) } });
}

/** How many more cuts the lookahead may send: the pool's size less the cuts queued or out. */
export function cutSlots(queue) {
    if (poolBroken()) return 0;
    return Math.max(0, rasterPool.size() - queue.pending("cut"));
}

/**
 * The job into `queue`: a promise of its result (a cut's regions as Loops, a descent's steps), or null when the pool
 * is broken. `job` is `cutJob`'s input, or `{world, input}` for a descent; it is wired at dispatch.
 */
export function submit(queue, { kind, barrier = false, job }) {
    if (poolBroken()) { stats.inline++; return null; }
    return new Promise((resolve, reject) => {
        const st = { kind: "cut", prio: PRIO.cut, barrier: !!barrier, cells: [], lost: 0 };
        const lose = (why) => {
            queue.done(st.id);
            stats.lost++;
            reject(Object.assign(new Error("cut lost: " + why), { why }));
        };
        st.entry = {
            req: {
                cut: kind, prio: PRIO.cut,
                wire: () => (kind === "descent" ? wireDescent(job.world, job.input) : wireJob(job)),
                onResult: (out) => {
                    queue.done(st.id);
                    stats.landed++;
                    let r;
                    try { r = kind === "descent" ? unwireDescentResult(out) : unwireResult(out); } catch (err) { reject(Object.assign(err, { why: "unwire" })); return; }
                    resolve(r);
                    queue.pump();
                },
                onDrop: (d) => lose((d && d.why) || "failed"),
                onRequeue: (jobId, why) => {
                    if (why === "watchdog" || st.lost) { lose(why); return; }
                    st.lost++;
                    stats.requeued++;
                    if (queue.requeue(st.id)) Promise.resolve().then(() => queue.pump());
                },
            },
            plates: null,
        };
        stats.jobs++;
        queue.push([st]);
        queue.pump();
    });
}

/** Tests: the counts zeroed. */
export function resetEraseWorkerClient() { for (const k of Object.keys(stats)) stats[k] = 0; }

/** Dev/diagnostics: cuts sent, run inline, landed, requeued once, and lost (each lost one a refusal). */
export function eraseWorkerStats() { return { ...stats }; }
