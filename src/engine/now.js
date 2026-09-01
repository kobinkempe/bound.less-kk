/**
 * The clock every measurement in the engine is taken against.
 *
 * `performance.now()` is a monotonic high-resolution timer, which is what a
 * duration needs: `Date.now()` can step backwards when the system clock is
 * adjusted, and a negative frame time reaching the perf log or the frame meter
 * would be indistinguishable from a real anomaly. The fallback exists only for
 * environments that do not define `performance` at all.
 */
export function perfNow() {
    return (typeof performance !== "undefined" ? performance.now() : Date.now());
}
