/**
 * Copy a mixin class's methods onto another class's prototype.
 *
 * WHY A CLASS AND NOT AN OBJECT LITERAL. `KobinEngine.js` was 3,506 lines, and
 * the groups that came out of it - the erase pipeline, selection, the overlays,
 * files, scenes - are cohesive enough to read on their own but far too tangled
 * with engine state to become collaborators with their own constructors. They
 * are still the engine's methods; they just live in another file. Writing them
 * as a class body means the split was a MOVE: every method arrived here
 * byte-identical, indentation and comments included, with no reformatting for a
 * reviewer to read past.
 *
 * WHY NOT `Object.assign`. Class prototype methods are non-enumerable, so
 * `Object.assign` copies none of them - it silently produces an engine with no
 * methods. Descriptors also carry getters and setters intact, which a
 * value-copy would invoke and flatten.
 *
 * The mixin classes are never instantiated; `Foo.prototype` is the whole point
 * of them. Their methods run with `this` bound to the KobinEngine instance.
 */
export function mixin(target, ...protos) {
    for (const proto of protos) {
        const desc = Object.getOwnPropertyDescriptors(proto);
        delete desc.constructor;
        for (const key of Object.keys(desc)) {
            if (key in target) {
                throw new Error(`mixin: ${key} is already defined on the target prototype`);
            }
        }
        Object.defineProperties(target, desc);
    }
    return target;
}
