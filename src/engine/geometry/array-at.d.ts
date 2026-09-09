// For `npm run typecheck` only (tsconfig.geometry.json): TypeScript 4.2's libraries
// predate `Array.prototype.at` (es2022); src/polyfills.js supplies it at run time.
interface Array<T> { at(index: number): T | undefined; }
interface ReadonlyArray<T> { at(index: number): T | undefined; }
