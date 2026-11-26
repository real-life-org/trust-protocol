// ports — what the library needs from its host (lib Stage 2, note §3).
//
// The library defines the ports, the app implements them; each is cut
// to what its one user needs. There is no send port: results carry
// Outbound[], input arrives through receive, adapter reports through
// report, retries through resume. Types only.
import type { Json } from './core.js'
import type { Envelope } from './delivery.js'
import type { OpaqueHolderState } from './state.js'

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
  commit (version: string | null, next: OpaqueHolderState): Promise<CommitResult>
}

// ── KeyProvider (user: act preparation) ────────────────────────────────

/** The engine's release of an rkid, read from `addresses` (Delivery §5):
 *  the label it derives under, a tombstone, or unknown. The provider
 *  never revives a retired key from a cache. */
export type KeyRelease = (rkid: string) =>
  | { status: 'live', label: string }
  | { status: 'retired' }
  | { status: 'unknown' }

/** Outcome of a key agreement: the raw X25519 shared secret, or why not.
 *  `invalid`: the epk is not 32 bytes or yields the all-zero secret (a
 *  low-order point, Delivery §5) — the sender's fault, never the host's. */
export type Agreement =
  | { status: 'available', shared: Uint8Array }
  | { status: 'retired' }
  | { status: 'unknown' }
  | { status: 'invalid' }

/** A carrier-relationship principal (Identity §7a.4) with its signing operation. */
export interface CarrierKey {
  principal: string
  sign (bytes: Uint8Array): Promise<Uint8Array>
}

/** The connection side of a carrier context (profile spec/adapter-vti-mediator.md §1): the
 *  connection DID of one relationship at one carrier and that carrier's identifier `C`. Public
 *  values only; this is what a wire factory receives. */
export interface CarrierConnection {
  readonly did: string
  readonly carrier: string
}

/**
 * One relationship at one carrier, opened once from its 32-byte carrier nonce `N` and `C`
 * (Identity §7a.4, §13): the control principal with its signing operation, and the connection
 * DID. Both sides come from the same (`N`, `C`) in one call, so an adapter, a delivery hint, a
 * holder's proofs and a wire built from one context speak for one relationship. Every part is
 * frozen. `N` itself is not in it.
 *
 * Trust boundary: for `seedKeys` the common origin holds by construction (`N` copied at entry,
 * both derived from that copy). A provider a host writes itself (a keystore) MUST keep it: a
 * context whose principal and connection come from two relationships is a non-conforming
 * provider, and no consumer can detect it from the two DIDs.
 */
export interface CarrierContext {
  readonly carrier: string
  readonly principal: CarrierKey
  readonly connection: CarrierConnection
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
  /** DEVIATION D7: the carrier context of one relationship at one carrier (`CarrierContext`): `nonce` is the
   *  relationship's 32-byte carrier nonce, `carrier` is `C` exactly as configured. Every call
   *  returns new frozen objects. A host builds the transport adapter, its delivery hint and the
   *  wire from it and never needs the root. Optional until the app's port is cast. */
  carrierContext? (nonce: Uint8Array, carrier: string): Promise<CarrierContext>
  /** the holder's service identity for the group it founds, as a did:key
   *  (Access 3265). DEVIATION D3: derived from the root IKM and the group
   *  DID under a prefix of stage 1, since Identity §7's derivation needs
   *  the genesis digest the genesis itself fixes */
  serviceIdentity (group: string): Promise<string>
  /** the epoch-0 content key of a group the holder founds (Access 9710), 32
   *  bytes, derived from the root IKM and the group DID under a prefix of
   *  stage 1: never stored, derived again when the key port needs it */
  contentKey (group: string): Promise<Uint8Array>
  /** the two 32-byte seeds of one shared-connect encounter (messaging identity, pairwise
   *  identifier), derived from the root and a 16-byte nonce this side minted for the encounter:
   *  the inviter's is its link handle (`_id`), the responder's its own challenge (the propose id);
   *  never the other side's value, so no counterpart chooses this side's identifiers. Under a
   *  prefix of stage 1 (DEVIATION D5); derived again after a restart, never stored. Optional
   *  until the app's port is cast. */
  sharedConnectSeeds? (nonce: Uint8Array): Promise<{ messaging: Uint8Array, pair: Uint8Array }>
  /** the messaging identity of one shared-connect encounter for the holder: the public keys (the did:peer:2 is
   *  built from them with the relays) and a signing callback over hash data; the key stays inside. The same
   *  derivation as `sharedConnectSeeds().messaging` through `partyFromSeeds`, so the app's wire and the holder
   *  hold one identity. The pairwise identifier is a register label (`anchorOf`), not derived here (design (d)). */
  sharedConnectMessaging? (nonce: Uint8Array): Promise<{ ed: Uint8Array, x: Uint8Array, sign: (hashData: Uint8Array) => Promise<Uint8Array> }>
  /** EXPERIMENTAL, DEVIATION D6: the person's identity toward one web app they log into (a
   *  SIOPv2-shaped login): a did:key and a signing callback over raw bytes; the key stays inside.
   *  One identity per origin (`scheme://host[:port]`): web apps on two origins cannot link the person;
   *  two web apps on different paths of one origin get the same identity. Every call returns its own
   *  frozen object.
   *  Derived from the root and the origin outside the label registry of Identity §6.1; replaced
   *  at identity stage 3, no migration of accounts made with it is promised (issue #211). */
  loginIdentity? (origin: string): Promise<{ did: string, sign: (bytes: Uint8Array) => Promise<Uint8Array> }>
}

// ── Log (user: rotation; optional) ─────────────────────────────────────

/** Head of the community anchor's log (Identity §5.4): its entry, the
 *  generation, the head anchor and the pre-rotation binding commit(gen+1). */
export type LogHead =
  | { genesis: string, entryId: string, gen: number, next: string, commit: string }
  | { genesis: string, empty: true }

/** One entry of the lineage: the one that introduced a generation. */
export interface LogEntryRef { entryId: string, next: string, commit: string }

/** Idempotent over exactly (entry, overHead): the same closure again
 *  answers `exists` (a restart's repeat); the same entry over another head
 *  is `head-conflict` (read the head, and at(), again). */
export type AppendResult =
  | { status: 'appended', head: LogHead }
  | { status: 'exists', head: LogHead }
  | { status: 'head-conflict', head: LogHead }
  | { status: 'failure', reason: string }

/** Without a Log, rotation is refused ('log-missing'); an encounter-only
 *  holder needs no dummy. */
export interface Log {
  head (): Promise<LogHead>
  /** the entry of the lineage the head stands on that introduced
   *  generation `gen` (≥ 2), or null where the log holds none: lets a
   *  rotation whose append answer was lost recognize its entry after the
   *  log moved on, and tell that from a fork */
  at (gen: number): Promise<LogEntryRef | null>
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

/** Receiver refusal codes an adapter may convey: the terminal codes of
 *  `trust-task-error/0.5` and `0.6` (VTI mediator profile, RLTP-VTI-5015,
 *  5020). An
 *  extended code reaches the port as `taskFailed`; `idConflict` is an
 *  answer, never a refusal (RLTP-VTI-5030). */
export type ReceiverRefusalCode =
  | 'malformedRequest' | 'unsupportedType' | 'unsupportedVersion' | 'unsupportedExtension'
  | 'proofRequired' | 'proofInvalid' | 'permissionDenied'
  | 'wrongRecipient' | 'identityMismatch' | 'cancelled' | 'taskFailed'

/** Sender failure reasons, closed (Delivery §6.1). An adapter's or the
 *  holder's own give-up is `expired-by-adapter-policy`. */
export type DeliveryFailure = 'unroutable' | 'oversize' | 'expired-by-adapter-policy' | 'rejected-by-receiver'

/** Why a submission still waits before the trias (Delivery §6.1). */
export type PreTransportReason = 'offline' | 'transport-unreachable' | 'carrier-refused-retriable'

/** A report about a submission the service has taken: the status trias.
 *  `held` on `accepted`: the counterpart answered with a validated
 *  trust-task-next-step (Delivery RLTP-DEL-6140, VTI RLTP-VTI-5050) — the
 *  document arrived and waits there; no horizon ends it, only a valid
 *  acknowledgement or a validated terminal refusal. */
export type TriasReport =
  | { digest: string, status: 'accepted', held?: true }
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
 *  tuple it travels on (the app's sending relationship, Delivery §5a), or
 *  of the own key it is sent from where no tuple carries it (a member
 *  anchor, Membership 3.1); `keyAgreement` the counterpart key the
 *  envelope is sealed to; `anchor`, set where no tuple carries the
 *  document, the anchor it is addressed to (its ack's issuer, 4.2). */
/** `via`: where `rkid` is no tuple's (a member key, Membership), the own
 *  rkid of the relationship tuple the contact was named through — what a
 *  split of the contact's entry follows (Trust 2080). */
export interface Recipient { contactId: string, rkid: string, keyAgreement: string, anchor?: string, via?: string }

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
  /** delay before attempt n+1 after attempt n, in ms; finite and
   *  non-negative, rounded up to whole ms */
  backoff (attempt: number): number
  /** the holder's own give-up: this long after the first submission every
   *  non-terminal item (submitted, accepted, or held by the adapter as
   *  awaiting-transport) becomes failed(expired-by-adapter-policy) — except
   *  an accepted item that is held at the recipient (Delivery RLTP-DEL-6140).
   *  Within Delivery's give-up range [P1D, P90D]. It also sets the
   *  retention of effects and the act journal, max(P90D, horizonMs) —
   *  Delivery §7 key-retention. There is no attempt-count give-up:
   *  re-emissions are local and say nothing about transport. */
  horizonMs: number
  /** CAS attempts of one act before InfraError('commit-conflict'); default 8 */
  commitAttempts?: number
}
