// Loaded first by src/index.js and src/setupTests.js.
// `Array.prototype.at`: a Loop (engine/geometry/loop.js) and a plain piece array are
// read alike with `.at(i)`; Node 14 and browsers before Chrome 92 lack it.
/* eslint-disable no-extend-native */
if (!Array.prototype.at) {
    Object.defineProperty(Array.prototype, "at", {
        value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return n < 0 || n >= this.length ? undefined : this[n]; },
        writable: true, configurable: true,
    });
}
