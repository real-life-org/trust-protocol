// ports — what the library needs from its host (lib Stage 2, note §3).
//
// The library defines the ports, the app implements them; each is cut
// to what its one user needs. There is no send port: results carry
// Outbound[], input arrives through receive, adapter reports through
// report, retries through resume. Types only.
import type { Json } from './core.js'
import type { Envelope } from './delivery.js'
import type { HolderState } from './state.js'

// ── Store (user: the engine) ───────────────────────────────────────────

/** A deep, independent snapshot. `state` is raw stored JSON (or null for
 *  an empty store) — the engine decodes it (decodeState), the store
 *  never migrates. `version` is an opaque token, null for an empty store. */
export interface StoreSnapshot { state: unknown, version: string | null }

export type CommitResult = { ok: true, version: string } | { ok: false, reason: 'conflict' }

/**
 * Durable holder state with compare-and-swap. `commit(version, next)`
 * succeeds only if the store is still at `version` (null: still empty),
 * stores a copy atomically and returns the new version; otherwise it
 * writes nothing. The version token serves CAS and nothing else: a store
 * MUST NEVER reuse a token within its lifetime, reopening included, even
 * when the content returns to an earlier value (no ABA). What the holder
 * journals and announces is its own `commitSeq`, written inside `next`
 * (state.ts), because the token is known only after the commit.
 * Durability: visible to every later reader of the same store instance;
 * persistent adapters additionally across process loss.
 * Stage 2 assumes ONE writer per holder; the adapter guarantees it.
 * A commit whose outcome is unknown surfaces as InfraError
 * 'unknown-commit-outcome' and is resolved by re-reading (act journal).
 */
export interface Store {
  read (): Promise<StoreSnapshot>
  commit (version: string | null, next: HolderState): Promise<CommitResult>
}

// ── KeyProvider (user: act preparation) ────────────────────────────────

/** The engine's release of an rkid, read from `addresses` (Delivery §5):
 *  the label it derives under, a tombstone, or unknown. The provider
 *  never revives a retired key from a cache. */
export type KeyRelease = (rkid: string) =>
  | { status: 'live', label: string }
  | { status: 'retired' }
  | { status: 'unknown' }

/** Outcome of a key agreement: the raw X25519 shared secret, or why not. */
export type Agreement =
  | { status: 'available', shared: Uint8Array }
  | { status: 'retired' }
  | { status: 'unknown' }

/** A carrier-relationship principal (Identity §7a.4) with its signing operation. */
export interface CarrierKey {
  principal: string
  sign (bytes: Uint8Array): Promise<Uint8Array>
}

/**
 * Key operations over the holder's secret. Reads no state; modules never
 * see a seed. The library's default is seedKeys(seed); an app may bind a
 * keystore, secure enclave or passkey instead.
 */
export interface KeyProvider {
  /** the anchor and key-agreement Multikey of a register label */
  anchorOf (label: string): Promise<{ anchor: string, keyAgreement: string }>
  /** Ed25519 signature under the label's anchor key */
  sign (label: string, bytes: Uint8Array): Promise<Uint8Array>
  /** X25519 with the private key behind `rkid`, only if `allowed` releases it */
  agree (rkid: string, epk: Uint8Array, allowed: KeyRelease): Promise<Agreement>
  /** Identity §7a.4: nonce is the relationship's 32-byte carrier nonce */
  carrierPrincipal (nonce: Uint8Array, carrier: string): Promise<CarrierKey>
}

// ── Log (user: rotation; optional) ─────────────────────────────────────

/** Head of the community anchor's log (Identity §5.4): its entry, the
 *  generation, the head anchor and the pre-rotation binding commit(gen+1). */
export type LogHead =
  | { genesis: string, entryId: string, gen: number, next: string, commit: string }
  | { genesis: string, empty: true }

/** Idempotent over exactly (entry, overHead): a restart sees `exists`. */
export type AppendResult =
  | { status: 'appended', head: LogHead }
  | { status: 'exists', head: LogHead }
  | { status: 'head-conflict', head: LogHead }
  | { status: 'failure', reason: string }

/** Without a Log, rotation is refused ('log-missing'); an encounter-only
 *  holder needs no dummy. */
export interface Log {
  head (): Promise<LogHead>
  /** `overHead` is the entryId the entry extends, null over an empty log */
  append (entry: Json, overHead: string | null): Promise<AppendResult>
}

// ── Access (user: group star, membership) ──────────────────────────────

/** The holder's materialized view of one group (Access), as the group
 *  star's reception needs it (Trust 5.2b). `isMember` and `resolve` of
 *  one GroupAccess MUST describe one and the same materialized snapshot
 *  of the group, stable for as long as the object is used. */
export interface GroupAccess {
  /** the group's genesis digest */
  group: string
  /** is this anchor a current member? */
  isMember (anchor: string): boolean
  /** the canonical admission (or genesis) an oid names: its subject and card key */
  resolve (oid: string): { subject: string, keyAgreement: string } | null
}

export interface Access {
  /** every group the holder is a current member of */
  memberships (): Promise<GroupAccess[]>
  membership (group: string): Promise<GroupAccess | null>
}

// ── Delivery reports (user: report) ────────────────────────────────────

/** Receiver refusal codes an adapter may convey (VTI mediator profile). */
export type ReceiverRefusalCode =
  | 'malformedRequest' | 'unsupportedType' | 'proofRequired'
  | 'proofInvalid' | 'wrongRecipient' | 'identityMismatch'

/** Sender failure reasons, closed (Delivery §6.1). An adapter's or the
 *  holder's own give-up is `expired-by-adapter-policy`. */
export type DeliveryFailure = 'unroutable' | 'oversize' | 'expired-by-adapter-policy' | 'rejected-by-receiver'

/** Why a submission still waits before the trias (Delivery §6.1). */
export type PreTransportReason = 'offline' | 'transport-unreachable' | 'carrier-refused-retriable'

/** A report about a submission the service has taken: the status trias. */
export type TriasReport =
  | { digest: string, status: 'accepted' }
  | { digest: string, status: 'delivered', late: boolean }
  | { digest: string, status: 'failed', reason: Exclude<DeliveryFailure, 'rejected-by-receiver'> }
  | { digest: string, status: 'failed', reason: 'rejected-by-receiver', code: ReceiverRefusalCode }

/** A report before the trias: an adapter condition, never a verdict and
 *  never a fourth state; it ends when the submission enters the trias. */
export interface PreTransportReport { digest: string, status: 'awaiting-transport', reason: PreTransportReason }

/**
 * One adapter report about one submitted document, keyed by its digest
 * (Delivery §6.1). Idempotent per (digest, status); monotone except
 * failed → delivered on a late ack. `accepted` never arises from a
 * local commit. An adapter's `delivered` is its claim about transport:
 * it never stands in for the receive core's verification of the
 * delivery-ack, which alone completes a star salt (5660) or any effect.
 */
export type DeliveryReport = TriasReport | PreTransportReport

/** The adapter's mapping from its submission ids to document digests. */
export interface SubmissionRef { submissionId: string, digest: string }

// ── Outbound ───────────────────────────────────────────────────────────

/** Whom a document goes to. `rkid` is the own key-agreement id of the
 *  tuple it travels on (the app's sending relationship, Delivery §5a);
 *  `keyAgreement` the counterpart key the envelope is sealed to. */
export interface Recipient { contactId: string, rkid: string, keyAgreement: string }

/** A sealed document for the app to send. `digest` keys report();
 *  attempt > 1 is a retry. Pure JSON. */
export interface Outbound {
  digest: string
  envelope: Envelope
  type: string
  threadId: string
  recipient: Recipient
  attempt: number
}

// ── Retry policy (parameter of createHolder) ───────────────────────────

export interface RetryPolicy {
  /** delay before attempt n+1 after attempt n, in ms */
  backoff (attempt: number): number
  /** give up after this many attempts */
  maxAttempts: number
  /** or after this long since the first attempt, in ms */
  horizonMs: number
}
