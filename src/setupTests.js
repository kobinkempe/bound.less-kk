// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import './polyfills';
import '@testing-library/jest-dom';

// jsdom has no IndexedDB; the store (src/storage/db.js) runs on this double.
import 'fake-indexeddb/auto';

// jsdom has no requestAnimationFrame; two.js's ticker needs one.
if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
}

// jsdom has no canvas either. two.js probes `getContext` once at import and
// jsdom logs "Not implemented: HTMLCanvasElement.prototype.getContext" as a
// console.error into every suite that reaches the renderer — hundreds of
// lines of noise per run, with no test behind them. The probe wants a null
// (no canvas) and gets one here. Nothing in the suite draws on a canvas: the
// one caller in src/ (storage/thumbnails.js) guards its context, and rule 3
// in docs/ai/00-START-HERE.txt is that paint is measured in a real browser,
// never by rasterising to a canvas in jsdom.
if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = function getContext() { return null; };
}
