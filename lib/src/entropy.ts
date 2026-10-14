// entropy — the Entropy port (lib Stage 2, note §3).
//
// Randomness by closed purpose: every value the library draws names
// what it is for, so a scripted run replays per purpose rather than by
// position in one byte stream. No domain decisions travel here: group
// rules are group state, human choices are act input. Entropy is drawn
// fresh per preparation; after a version conflict an act is prepared
// again, never a nonce reused under another plaintext.
//
// This is the ONLY file in src/ that touches the platform's generators
// (test/entropy-lint.test.mjs enforces it).

/** What a random value is for. Star salts are counters, not entropy. */
export type EntropyPurpose =
  | 'seal.eph'        // ephemeral X25519 seed of an envelope (Delivery §5)
  | 'seal.nonce'      // AES-GCM nonce of an envelope (Delivery §5)
  | 'env.nonce'       // a nonce inside a document's own transport form
  | 'doc.id'          // document id (uuid)
  | 'thread.id'       // thread id (uuid)
  | 'ack.id'          // delivery-ack document id (uuid)
  | 'challenge'       // encounter challenge bytes
  | 'group.seed'      // group-star sealing seed (5.2b)
  | 'founding.nonce'  // relationship / group founding nonce (Identity §6.1, §7a.3)
  | 'drop.nonce'      // nonce of a dropped (filler) form
  | 'pad'             // padding bytes

export const ENTROPY_PURPOSES: readonly EntropyPurpose[] = Object.freeze([
  'seal.eph', 'seal.nonce', 'env.nonce', 'doc.id', 'thread.id', 'ack.id',
  'challenge', 'group.seed', 'founding.nonce', 'drop.nonce', 'pad',
])

export interface Entropy {
  /** n fresh bytes for `purpose`; a new buffer every call */
  bytes (purpose: EntropyPurpose, n: number): Uint8Array
  /** a fresh identifier for `purpose` (lowercase UUIDv4 by default) */
  id (purpose: EntropyPurpose): string
}

export type EntropyErrorCode = 'exhausted' | 'mismatch' | 'purpose' | 'length'

export class EntropyError extends Error {
  readonly code: EntropyErrorCode
  readonly purpose: string
  constructor (code: EntropyErrorCode, purpose: string, message: string) {
    super(`entropy ${code} (${purpose}): ${message}`)
    this.name = 'EntropyError'
    this.code = code
    this.purpose = purpose
  }
}

const PURPOSES: ReadonlySet<string> = new Set(ENTROPY_PURPOSES)
const checkPurpose = (purpose: string): void => {
  if (!PURPOSES.has(purpose)) throw new EntropyError('purpose', purpose, 'not an entropy purpose')
}
const checkLength = (purpose: string, n: number): void => {
  if (!Number.isSafeInteger(n) || n < 0) throw new EntropyError('length', purpose, `invalid length ${n}`)
}

// getRandomValues fills at most 65536 bytes per call
const QUOTA = 65536

/** Platform randomness; the crypto handle is resolved here, not at import. */
export function randomEntropy (c: Pick<Crypto, 'getRandomValues' | 'randomUUID'> = globalThis.crypto): Entropy {
  if (typeof c?.getRandomValues !== 'function' || typeof c?.randomUUID !== 'function') throw new Error('randomEntropy: no WebCrypto getRandomValues/randomUUID in this runtime')
  return {
    bytes (purpose, n) {
      checkPurpose(purpose); checkLength(purpose, n)
      const out = new Uint8Array(n)
      for (let i = 0; i < n; i += QUOTA) c.getRandomValues(out.subarray(i, Math.min(n, i + QUOTA)))
      return out
    },
    id (purpose) {
      checkPurpose(purpose)
      return c.randomUUID()
    },
  }
}

export type EntropyScript = Partial<Record<EntropyPurpose, Uint8Array | string | Array<Uint8Array | string>>>

/**
 * Scripted entropy for vectors and tests: each purpose yields its values
 * in order (a single value is a list of one) and throws 'exhausted' when
 * it runs dry. bytes() needs a Uint8Array of exactly n bytes, id() a
 * string — anything else is 'mismatch'. Values are copied in and out.
 */
export function scriptedEntropy (script: EntropyScript): Entropy {
  const queues = new Map<string, Array<Uint8Array | string>>()
  for (const [purpose, v] of Object.entries(script)) {
    checkPurpose(purpose)
    if (v === undefined) continue
    queues.set(purpose, (Array.isArray(v) ? v : [v]).map((x) => (x instanceof Uint8Array ? x.slice() : x)))
  }
  const next = (purpose: string): Uint8Array | string => {
    checkPurpose(purpose)
    const q = queues.get(purpose)
    if (!q || q.length === 0) throw new EntropyError('exhausted', purpose, 'script ran dry')
    return q.shift()!
  }
  return {
    bytes (purpose, n) {
      checkLength(purpose, n)
      const v = next(purpose)
      if (!(v instanceof Uint8Array) || v.length !== n) throw new EntropyError('mismatch', purpose, `expected ${n} bytes`)
      return v.slice()
    },
    id (purpose) {
      const v = next(purpose)
      if (typeof v !== 'string') throw new EntropyError('mismatch', purpose, 'expected a string id')
      return v
    },
  }
}
