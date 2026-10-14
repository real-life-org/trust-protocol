// util-freeze — deep freezing, shared by the engine and the views.

/** Freezes an object graph in place and returns it. */
export function freezeDeep<T> (x: T): T {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const v of Object.values(x as object)) freezeDeep(v)
  }
  return x
}
