// The software key binding for a VTI mediator wire over OpenVTC's packages — published as
// @real-life/trust-protocol/adapters/vti-mediator/software-keys.
//
// vti-tsp-js 0.4.0 signs at pack time with private Ed25519 bytes and opens at unpack time with
// private X25519 bytes; vti-didcomm-js 0.13.0 builds private X25519 JWKs for the authentication
// and for the running session. A wire over them needs the raw seed of the connection DID. This
// entry point releases it, for one connection only: the `connection` object of a carrier context
// opened by `seedKeys(seed, { exportConnectionSeed: true })`. Nothing else releases a key: not a
// provider, not a copy of the object, not a context from a keystore that keeps its keys. Whoever
// holds the seed can act as this connection for as long as it is registered and can open the
// outer TSP layers sent to it; the RLTP seal inside has its own key.
//
// Goes away once OpenVTC takes signing and agreement callbacks
// (OpenVTC/vta-browser-plugin#459, OpenVTC/vti-didcomm-js#47).
import { boundConnectionSeed } from '../connection-seed.js'

/** The 32-byte Ed25519 seed of the connection DID behind `connection` (a carrier context's
 *  `connection`), as a fresh copy. Throws when the key provider did not release it: a keystore
 *  that keeps its keys, or `seedKeys` without `exportConnectionSeed`. */
export function connectionSeed (connection: unknown): Uint8Array {
  const seed = boundConnectionSeed(connection)
  if (seed === null) {
    throw new Error('connectionSeed: the key provider did not release this connection\'s key; the wire over OpenVTC needs raw key bytes (seedKeys with exportConnectionSeed, or a wire that signs through the provider)')
  }
  return seed
}
