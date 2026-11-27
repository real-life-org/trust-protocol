// connection-seed — the one place where the raw key of a connection DID can leave the library.
//
// The OpenVTC packages the reference wire runs on (vti-tsp-js 0.4.0 pack/unpack, vti-didcomm-js
// 0.13.0 authentication and session) take private key bytes, not signing or agreement
// callbacks. Until they do (OpenVTC/vta-browser-plugin#459, OpenVTC/vti-didcomm-js#47), a wire
// over them needs the 32-byte Ed25519 seed of the connection DID. The general KeyProvider port
// has no export method: any holder of a provider could ask it for any (N, C) it knows. Instead,
// `seedKeys(seed, { exportConnectionSeed: true })` binds the seed to the frozen `connection`
// object of each carrier context it opens, and only that object releases it, through the narrow
// entry point `./adapters/vti-mediator/software-keys`. A provider that keeps its keys (a
// keystore) binds nothing, and the wire fails at its opening with a clear error.
//
// Two limits, stated: the opt-in is the provider's, so whoever holds a provider built with it can
// open an exporting context for every (N, C) it knows; the scope to one relationship holds where
// only the `connection` object is passed on (to the wire). And the binding lives in this module
// instance: a second copy of the library loaded beside the first has its own map and refuses a
// connection of the first.

const seeds = new WeakMap<object, Uint8Array>()

/** Bind the connection seed to the context's connection object (keys-seed only). */
export function bindConnectionSeed (connection: object, seed: Uint8Array): void {
  seeds.set(connection, new Uint8Array(seed))
}

/** The seed bound to this connection object, a fresh copy, or null. */
export function boundConnectionSeed (connection: unknown): Uint8Array | null {
  if (connection === null || typeof connection !== 'object') return null
  const s = seeds.get(connection)
  return s ? new Uint8Array(s) : null
}
