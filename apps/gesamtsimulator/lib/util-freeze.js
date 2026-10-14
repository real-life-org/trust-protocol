// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// util-freeze — deep freezing, shared by the engine and the views.
/** Freezes an object graph in place and returns it. */
export function freezeDeep(x) {
    if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
        Object.freeze(x);
        for (const v of Object.values(x))
            freezeDeep(v);
    }
    return x;
}
