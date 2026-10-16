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
  /** the anchor mapping needs the holder's community anchor (register.community, Identity §5.4) */
  | 'no-community'
  | 'unknown-digest'
  /** prompt.decide: no open prompt has this id */
  | 'unknown-prompt'
  /** prompt.decide: the prompt's expiresAt is not after when; tick removes it */
  | 'prompt-expired'
  /** trust.merge: the manual merge joins at most one entry (6640), and
   *  never relationships the binding rule keeps apart (6605) */
  | 'not-mergeable'
  /** identity.addDevice: not a device name of 6.2 (Identity §5.5) */
  | 'device-name-invalid'
  /** identity.addDevice: the register already holds the name (Identity §5.5, SHOULD) */
  | 'device-name-held'
  /** identity.addDevice: a revoked name is never given again (Identity §5.5) */
  | 'device-name-revoked'
  /** identity.revokeDevice: the register holds no such device name */
  | 'unknown-device'
  /** identity.rotate: the log replica does not hold the lineage through the
   *  current generation (Identity §5.4, Access RLTP-ACC-5980); the rotation
   *  stays pending until it does */
  | 'log-behind'
  /** identity.rotate: the log's head is no generation of this register's
   *  lineage (another genesis, or a head the register does not follow) */
  | 'log-diverged'
  /** identity.rotate: the log answered failure; the rotation stays pending */
  | 'log-failure'
  /** setProfile: the body breaks 6430/6435 or its image 6475 */
  | 'profile-invalid'
  /** encounter: a card that fails Encounter 6 (schema, version, challenge,
   *  keys, proof) or is not of the profile the act needs (displayed for a
   *  scan, sent and addressed to an own challenge's anchor for a capture) */
  | 'card-invalid'
  /** encounter.scan: this displayed code was scanned already: its
   *  challenge is in a record (5.3, 5170) */
  | 'already-scanned'
  /** encounter.capture: the bound challenge resolves unknown (5460) */
  | 'gate-expired'
  /** encounter: the own challenge is future-dated beyond the skew (5390) */
  | 'gate-future'
  /** encounter.capture: the challenge was consumed by another enactment (5440) */
  | 'consumed-challenge'
  /** encounter.capture: the same counterparty with other material (5450) */
  | 'card-mismatch'
  /** encounter.counter: no enactment record of the contact to issue on */
  | 'no-record'
  /** encounter.counter: the own step credential is issued already */
  | 'already-issued'
  /** membership: no such group, or the holder holds no role in it the act needs */
  | 'unknown-group'
  /** membership.vouch: no consent pair held for this member (Access 5.3) */
  | 'no-evidence'
  /** membership.vouch: the admitting member's own vouch never counts beside its admission */
  | 'own-admission'
  /** membership.found: a genesis admits under the rule of one; a stricter rule needs policy.change */
  | 'threshold-unsupported'
  /** introduction: no such act, or not in a state that allows the step */
  | 'unknown-act'
  /** introduction.request: the mediator's ack-delay declaration is not held (Delivery 4.4) */
  | 'no-declaration'

export type ActResult =
  /** nextDueAt: duty work this act opened or unblocked is due then (`when`:
   *  now) — call resume at that time (engine.ts) */
  | { ok: true, outbound: Outbound[], events: HolderEvent[], nextDueAt?: number }
  | { ok: false, code: ActError, ref?: string }

/** Receiver failure dispositions (Delivery §6.2), by the stage that names them. */
export type ReceiveFailure =
  | 'oversize'             // stage 1
  | 'malformed'            // stages 2, 4, 5, 7
  | 'decryption-failed'    // stage 3
  | 'wrong-recipient'      // stage 5
  | 'unknown-type'         // stage 6
  | 'validation-failed'    // stages 6 (the entry's proof declaration), 8, 9
  | 'stale-issuance'       // stage 8
  | 'gate-future'          // stage 9
  | 'consumed-challenge'   // stage 9

export type ReceiveStageNo = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

/**
 * The outcome of receive(env, when). `unique`: the effect committed,
 * with its ack first among `outbound` where the type acknowledges (a
 * delivery-ack itself is terminal and earns none), then the documents
 * the effect issued. `duplicate-known`: the stored ack is re-sent
 * byte-identical (none for a terminal document); nothing commits beyond
 * a raised lastWhen. `failed`: nothing took effect and nothing commits.
 * `discarded`: the document's chunk met a receiver resource limit (Trust
 * 5365, reason `resource-limit`) or, authenticated, violated the assembly
 * rules so that its whole delivery is rejected (5260–5310, 5500, 5510,
 * reason `rejected`): the open assembly is dropped and its salt held as
 * the lower bound (5366), committed; no cache entry, no ack, no event.
 * Delivery §6.2 has no disposition for it yet (receive.ts: a gap for
 * Delivery 0.82).
 */
export type ReceiveResult =
  | { disposition: 'unique', digest: string, type: string, outbound: Outbound[], events: HolderEvent[], /** as on ActResult */ nextDueAt?: number }
  | { disposition: 'duplicate-known', digest: string, outbound: Outbound[] }
  | { disposition: 'discarded', digest: string, type: string, reason: 'resource-limit' | 'rejected', ref?: string }
  | {
    disposition: 'failed', reason: ReceiveFailure, stage: ReceiveStageNo, digest?: string,
    /** local diagnosis of a key failure, never a disposition of its own
     *  (Delivery §5, §6.2): 'unknown' — an rkid this holder never issued,
     *  failed(malformed) at stage 2; 'retired' — a tombstone (or a key
     *  marked retired), failed(decryption-failed) at stage 3 */
    key?: 'unknown' | 'retired'
    /** the rule the document failed, where its task handler names one
     *  (TaskRefusal.ref), e.g. RLTP-TRU-6118 */
    ref?: string
  }

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
  /** testing mode only (createHolder's `invariants: true`): a commit would
   *  break an invariant of invariants.ts; nothing committed, the
   *  violations are the cause */
  | 'invariant-violated'

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
