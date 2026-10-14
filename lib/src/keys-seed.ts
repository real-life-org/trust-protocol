// keys-seed — the library's default KeyProvider (lib Stage 2, note §3).
//
// Every key derives from one root seed exactly as identity.ts and
// carrier-identity.ts derive it — the same HKDF (SHA-256, empty salt)
// and the same info strings — so the shipped vectors stay valid:
//
//   anchor of a label   'rltp/anchor/ed/' + label, 'rltp/anchor/x/' + label
//                       under the closed registry (Identity §6.1)
//   carrier principal   CARRIER_INFO_PREFIX + Dc + Dn (Identity §7a.4)
//
// The provider reads no state. agree() asks the engine's release
// (`allowed(rkid)`, from `addresses`) on EVERY call, cached key or not,
// so a retired key is never revived from the cache. Derived keys are
// cached in a Map outside the holder state (keys are not state, Identity
// 9.3). The WebCrypto handle is the caller's or the global one, resolved
// here, at construction — never at import.
import { base58, b64uOf, fromB64u } from './core.js'
import { cat } from './crypto.js'
import { canonicalLabel } from './identity.js'
import { CARRIER_INFO_PREFIX, validCarrierIdentifier } from './carrier-identity.js'
import type { Agreement, CarrierKey, KeyProvider, KeyRelease } from './ports.js'

const te = new TextEncoder()
/** PKCS#8 prefixes of a raw 32-byte Ed25519 / X25519 private key */
export const ED_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20])
export const X_PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20])

interface LabelKeys { ed: CryptoKey, x: CryptoKey, anchor: string, keyAgreement: string }

/** The default KeyProvider over a root seed (the identity's root IKM). */
export function seedKeys (seed: Uint8Array, crypto: Pick<Crypto, 'subtle'> = globalThis.crypto): KeyProvider {
  if (!(seed instanceof Uint8Array) || seed.length < 32) throw new Error('seedKeys: the root seed must be at least 32 bytes')
  const S = crypto?.subtle
  if (!S) throw new Error('seedKeys: no WebCrypto subtle in this runtime')
  const ikm = seed.slice()

  const hkdf = async (info: string): Promise<Uint8Array> => {
    const k = await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) }, k, 256))
  }
  const pubOf = async (priv: CryptoKey): Promise<Uint8Array> => fromB64u((await S.exportKey('jwk', priv)).x!)
  const edKey = (s: Uint8Array): Promise<CryptoKey> => S.importKey('pkcs8', cat(ED_PKCS8, s), { name: 'Ed25519' }, true, ['sign'])
  const mh = async (bytes: Uint8Array): Promise<string> =>
    'u' + b64uOf(cat(Uint8Array.from([0x12, 0x20]), new Uint8Array(await S.digest('SHA-256', bytes))))

  const labels = new Map<string, Promise<LabelKeys>>()
  const derive = (label: string): Promise<LabelKeys> => {
    const canonical = canonicalLabel(label)
    if (canonical === null) return Promise.reject(new Error(`not a label of the closed registry (Identity §6.1): ${JSON.stringify(label)}`))
    let p = labels.get(canonical)
    if (!p) {
      p = (async () => {
        const ed = await edKey(await hkdf('rltp/anchor/ed/' + canonical))
        const x = await S.importKey('pkcs8', cat(X_PKCS8, await hkdf('rltp/anchor/x/' + canonical)), { name: 'X25519' }, true, ['deriveBits'])
        const anchor = 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(ed)))
        const keyAgreement = 'z' + base58(cat(Uint8Array.from([0xec, 0x01]), await pubOf(x)))
        return { ed, x, anchor, keyAgreement }
      })()
      p.catch(() => labels.delete(canonical))
      labels.set(canonical, p)
    }
    return p
  }

  const carriers = new Map<string, Promise<CarrierKey>>()

  return {
    async anchorOf (label) {
      const k = await derive(label)
      return { anchor: k.anchor, keyAgreement: k.keyAgreement }
    },

    async sign (label, bytes) {
      const k = await derive(label)
      return new Uint8Array(await S.sign({ name: 'Ed25519' }, k.ed, bytes))
    },

    async agree (rkid: string, epk: Uint8Array, allowed: KeyRelease): Promise<Agreement> {
      // the release first, every call: the cache never answers for it
      const rel = allowed(rkid)
      if (rel.status === 'retired') return { status: 'retired' }
      if (rel.status !== 'live') return { status: 'unknown' }
      let k: LabelKeys
      try { k = await derive(rel.label) } catch { return { status: 'unknown' } }
      if (k.keyAgreement !== rkid) return { status: 'unknown' }
      if (!(epk instanceof Uint8Array) || epk.length !== 32) return { status: 'invalid' }
      let shared: Uint8Array
      try {
        const pub = await S.importKey('raw', epk.slice(), { name: 'X25519' }, false, [])
        shared = new Uint8Array(await S.deriveBits({ name: 'X25519', public: pub }, k.x, 256))
      } catch { return { status: 'invalid' } }   // some runtimes refuse a low-order point themselves
      if (shared.every((b) => b === 0)) return { status: 'invalid' }
      return { status: 'available', shared }
    },

    carrierPrincipal (nonce, carrier) {
      if (!validCarrierIdentifier(carrier)) return Promise.reject(new Error('invalid carrier identifier (7a.2)'))
      if (!(nonce instanceof Uint8Array) || nonce.length !== 32) return Promise.reject(new Error('carrier nonce must be 32 bytes (7a.3)'))
      const n = nonce.slice()
      const key = carrier + '\u0000' + b64uOf(n)
      let p = carriers.get(key)
      if (!p) {
        p = (async () => {
          const info = CARRIER_INFO_PREFIX + await mh(te.encode(carrier)) + await mh(n)
          const priv = await edKey(await hkdf(info))
          const principal = 'did:key:z' + base58(cat(Uint8Array.from([0xed, 0x01]), await pubOf(priv)))
          return { principal, sign: async (bytes: Uint8Array) => new Uint8Array(await S.sign({ name: 'Ed25519' }, priv, bytes)) }
        })()
        p.catch(() => carriers.delete(key))
        carriers.set(key, p)
      }
      return p
    },
  }
}
