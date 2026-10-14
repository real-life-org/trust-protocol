// results — one closed result type for acts, one for reception, one error
// class for infrastructure (lib Stage 2, note §4.4).
//
// "Nothing to do" is ok with empty outbound. A committed act with open
// follow-up work is success plus a duty. Store and provider failures are
// InfraError; programming errors and broken invariants throw. Human text
// is the app's, made from the code.
import type { HolderEvent } from './events.js'
import type { Outbound } from './ports.js'

/** What resume(when) hands out: retries and due duties, in the engine's
 *  fixed order, and when to call again (absent: nothing is due). */
export interface ResumeResult { outbound: Outbound[], events: HolderEvent[], nextDueAt?: number }

/** Why an act was refused; `ref` on the result may name the rule. */
export type ActError =
  | 'unknown-contact'
  | 'no-own-channel'
  | 'tuple-deactivated'
  | 'already-given'
  | 'in-flight'
  | 'scope-exhausted'
  | 'stale-issuance'
  | 'actid-conflict'
  /** a human act came without the actId the app must mint (note §4.2) */
  | 'actid-missing'
  | 'log-missing'
  | 'unknown-digest'
  /** prompt.decide: no open prompt has this id */
  | 'unknown-prompt'
  /** prompt.decide: the prompt's expiresAt is not after when; tick removes it */
  | 'prompt-expired'

export type ActResult =
  | { ok: true, outbound: Outbound[], events: HolderEvent[] }
  | { ok: false, code: ActError, ref?: string }

/** Receiver failure dispositions (Delivery §6.2), by the stage that names them. */
export type ReceiveFailure =
  | 'oversize'             // stage 1
  | 'malformed'            // stages 2, 4, 5, 7
  | 'decryption-failed'    // stage 3
  | 'wrong-recipient'      // stage 5
  | 'unknown-type'         // stage 6
  | 'validation-failed'    // stages 8, 9
  | 'stale-issuance'       // stage 8
  | 'gate-future'          // stage 9
  | 'consumed-challenge'   // stage 9

export type ReceiveStageNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/**
 * The outcome of receive(env, when). `unique`: the effect committed,
 * with its ack among `outbound` where the type acknowledges.
 * `duplicate-known`: the stored ack is re-sent byte-identical (none for
 * a terminal document). `failed`: nothing took effect.
 */
export type ReceiveResult =
  | { disposition: 'unique', digest: string, type: string, outbound: Outbound[], events: HolderEvent[] }
  | { disposition: 'duplicate-known', digest: string, outbound: Outbound[] }
  | { disposition: 'failed', reason: ReceiveFailure, stage: ReceiveStageNo, digest?: string }

export type InfraErrorCode =
  | 'store-read'
  | 'store-commit'
  /** the commit may or may not have landed; re-read and consult the act journal */
  | 'unknown-commit-outcome'
  /** the store kept answering `conflict` past the retry bound (RetryPolicy.commitAttempts) */
  | 'commit-conflict'
  | 'key-provider'
  | 'log'
  | 'access'

/** A failure of a port the host provides, never of the protocol. */
export class InfraError extends Error {
  readonly code: InfraErrorCode
  constructor (code: InfraErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? code, options)
    this.name = 'InfraError'
    this.code = code
  }
}

/** The WebCrypto handle lacks what the library needs; raised when a
 *  holder is built, never at import (note §3 Crypto). */
export class CryptoUnavailableError extends Error {
  /** the algorithms (or 'subtle' itself) that are missing, in a fixed order */
  readonly missing: readonly string[]
  constructor (missing: readonly string[]) {
    super(`WebCrypto lacks: ${missing.join(', ')} (needs Ed25519, X25519, HKDF, HMAC, AES-GCM, SHA-256)`)
    this.name = 'CryptoUnavailableError'
    this.missing = Object.freeze([...missing])
  }
}
