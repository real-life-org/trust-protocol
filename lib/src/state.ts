// state — the holder's whole state as data (lib Stage 2, note §2.1).
//
// Pure JSON under a codec version (codec.ts): no CryptoKeys, promises,
// closures, glyphs or human text. Counters are canonical decimal
// strings, maps are records keyed by strings, sets are arrays, times
// are integer milliseconds. Everything open (duties, outbox, rotations,
// prompts, the act journal) lives here, so a restart loses nothing.
// Keys are not state (Identity 9.3); the KeyProvider derives them.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md);
// Identity §n is identity-layer.md, Delivery §n delivery-contract.md.
import type { Json } from './core.js'
import type { Envelope } from './delivery.js'
import type { HolderEvent } from './events.js'
import type { DeliveryFailure, LogHead, PreTransportReason, ReceiverRefusalCode, Recipient } from './ports.js'

/** Canonical decimal integer: "0" or no leading zero, at most 18 digits (2.1). */
export type Dec = string
/** Unpadded base64url bytes. */
export type B64u = string
/** Milliseconds since the epoch, a non-negative safe integer. */
export type Millis = number

declare const OPAQUE: unique symbol

/**
 * The holder's state at the consumer boundary (note §4.5): opaque. Store
 * adapters persist it as JSON and hand it back; apps never read inside it
 * and use the views (holder methods) instead. At runtime it is the
 * structural HolderState below, which only ./internal exposes.
 */
export interface OpaqueHolderState { readonly [OPAQUE]: 'HolderState' }

/** The structural state as the opaque one, for the store and the facade. */
export const toOpaque = (s: Readonly<HolderState>): OpaqueHolderState => s as unknown as OpaqueHolderState

export interface HolderState {
  /** state format version (codec.ts) */
  codec: number
  /** engine-owned commit sequence, +1 on every commit; journal and events
   *  carry it. The store's version token is for CAS only (ports.ts). */
  commitSeq: Dec
  /** highest `when` seen; a lower `when` is raised to it (note §4.7) */
  lastWhen: Millis
  register: Register
  addresses: Addresses
  /** keyed by entry id (= Contact.id) */
  contacts: Record<string, Contact>
  /** keyed by relationship id */
  relationships: Record<string, Relationship>
  entryOrder: EntryOrder
  /** keyed by group genesis digest */
  groups: Record<string, Group>
  profile: OwnProfile
  /** completed-effect cache, keyed by document digest (Delivery §6.2 stage 4/9) */
  effects: Record<string, Effect>
  /** issued documents, keyed by document digest */
  outbox: Record<string, OutboxItem>
  /** open duties, keyed by duty id */
  duties: Record<string, Duty>
  /** running rotations, keyed by rotation id */
  rotations: Record<string, Rotation>
  /** open decisions of the human, keyed by prompt id */
  prompts: Record<string, Prompt>
  /** act journal, keyed by actId (note §4.2) */
  acts: Record<string, ActRecord>
  encounter: EncounterState
}

// ── Identity ───────────────────────────────────────────────────────────

/** The label register (Identity §2, §6.3): every set grows only. */
export interface Register {
  /** canonical labels ever used (Identity §6.1) */
  labels: string[]
  /** pair label → its 32-byte relationship nonce (Identity §6.1) */
  pairNonces: Record<string, B64u>
  /** relationship id → carrier-nonce entries; canonical is the highest
   *  generation, then the smallest nonce (Identity §7a.3) */
  carriers: Record<string, CarrierNonce[]>
  /** device names and revocation marks, both monotone (Identity §5.5) */
  devices: { names: string[], revoked: string[] }
  /** the personal community: genesis digest and head generation (Identity §5.4) */
  community: { genesis: string, head: Dec } | null
  /** every signed anchor-rotation@2 the holder produced, chain order;
   *  the source of the lineage segments of 6420 */
  lineage: AnchorRotation[]
}

/** A signed anchor-rotation@2 artifact (Trust §6.5). */
export type AnchorRotation = { [field: string]: Json }

export interface CarrierNonce { nonce: B64u, generation: Dec }

/** Key-agreement addresses and their lifecycle (Delivery §5). */
export interface Addresses {
  /** rkid → the label it derives under and when it was last shown */
  keys: Record<string, AddressKey>
  /** retired rkids, kept forever; never shrinks */
  tombstones: string[]
}

export interface AddressKey { label: string, lastShown: Millis, retiredAt?: Millis }

// ── Contacts: the entries of the deliverable set ──────────────────────

/** The five trust classes (2720). */
export type TrustClass = 'star' | 'groupStar' | 'anchorMapping' | 'sealedGroupStar' | 'profile'
/** One setting per class and contact (2810). */
export type Setting = 'default' | 'on' | 'off'

/** A contact, i.e. one entry of the deliverable set (2120, 2140). */
export interface Contact {
  /** entry id: the surviving relationship identity (2100, 2140) */
  id: string
  /** entry-commit position (2120); null while no entry is committed (2060) */
  pos: Dec | null
  /** 'none' before the first verified mapping, 'pending' at a full set (2250) */
  status: 'none' | 'admitted' | 'pending'
  /** identities merged into this entry (2140) */
  aliases: string[]
  relIds: string[]
  /** the entry's anchor head (5610) */
  anchorHead: string | null
  /** per trust class (2810, merged by 2160) */
  settings: Record<TrustClass, Setting>
  /** sealed group star per group genesis (2830) */
  groupSettings: Record<string, Setting>
}

/** Two orders, kept apart. */
export interface EntryOrder {
  /** next entry-commit position (2120) */
  nextPos: Dec
  /** relationship ids by creation of their active head, oldest first (2180) */
  heads: string[]
}

// ── Relationships and tuples ───────────────────────────────────────────

/** A holder-local chain of tuples with one active head, plus chain state (2280). */
export interface Relationship {
  id: string
  contactId: string
  /** chain order, oldest first */
  tuples: Tuple[]
  /** ownPairLabel of the active tuple */
  activeHead: string
  /** earliest community anchor a mapping was issued under here (2285) */
  earliestAnchor: string | null
  /** links held from verified lineages (6610) */
  links: Array<{ prev: string, next: string }>
  /** anchor → pre-rotation binding held for it (6610) */
  bindings: Record<string, string>
  /** the counterpart's anchor head as last verified */
  heldCounterpartHead: string | null
  /** contact memory and evidence (2280) */
  memory: Record<string, Json>
  provenance: { kind: 'ceremony' | 'introduced', via?: string, at: Millis }
  /** set when this chain was appended into another (6a.4) */
  chainedInto: string | null
}

/** One pair context toward one counterpart: per-tuple state (2280). */
export interface Tuple {
  /** own `pair/…` label; identifies the tuple */
  ownPairLabel: string
  counterpartAnchor: string
  /** the counterpart's key-agreement Multikey, sealed to */
  counterpartKeyAgreement: string
  /** own key-agreement Multikey of this tuple (Delivery §5) */
  rkid: string
  /** the entry this tuple's verifications go to (2145) */
  entryId: string
  /** the active-head tuples of the holder's relationships when this
   *  tuple was created, frozen (2300) */
  priorCandidates: TupleRef[]
  starOut: StarOut
  starIn: StarIn
  /** the group star's own scope and domain (5730) */
  groupStarOut: GroupStarOut
  groupStarIn: GroupStarIn
  probeOut: { seq: Dec }
  probeIn: { hwm: Dec, lowerBound: Dec, assembly: Assembly | null }
  /** 6a.4: own continuity-mapping issuance (6300) and the open work on it */
  continuityOut: ContinuityOut
  /** 6a.4: verified continuity mapping; recordPrior frozen by 6290 */
  continuityIn: { rev: Dec, body: Json | null, recordPrior: string | null }
  /** issued anchor mapping (6300) and the anchor it was issued under */
  mappingOut: { rev: Dec, body: Json | null, underAnchor: string | null }
  /** verified anchor mapping, its self and card */
  mappingIn: { rev: Dec, body: Json | null, self: string | null, card: Json | null }
  /** verified profile (6b.2) */
  profileIn: { rev: Dec, body: Json | null, verifiedSeq: Dec }
  deactivated: boolean
}

/** A frozen reference to one tuple: its own pair label and the counterpart anchor. */
export interface TupleRef { ownPairLabel: string, counterpartAnchor: string }

/** Continuity work the tuple still owes (today's contMappingDue): the
 *  record side's choice (with the remaining alternatives), the non-record
 *  side's match report, or the alignment re-issue. */
export type ContinuityDue =
  | { kind: 'choice', prior: string, alts: string[] }
  | { kind: 'report', prior: string }
  | { kind: 'align', prior: string }

export interface ContinuityOut {
  /** last issued revision and body (6300/6310) */
  rev: Dec
  body: Json | null
  /** record side: the prior it chose, final once set (contChosen) */
  chosen: string | null
  /** non-record side: the match it reported (contReported) */
  reported: string | null
  /** an alignment re-issue was acknowledged (contAligned) */
  aligned: boolean
  due: ContinuityDue | null
}

/** Sender side of one reconciled sequence over view elements V (5.4):
 *  the salt scope, the baseline automaton and what is in flight. */
export interface SeqOut<V> {
  /** last issued salt, "0" before the first (5690) */
  lastSalt: Dec
  /** the scope issued its maximum and issues nothing further (2600/2610) */
  exhausted: boolean
  /** high-water mark H, highest completed salt (5630) */
  hwm: Dec
  /** snapshot S completed at H, or absent (5630) */
  snapshot: V[] | null
  /** salt → the view sent under it and its chunks' digests (5660) */
  inflight: Record<string, { view: V[], digests: string[], acked: string[] }>
}

/** Receiver side of one chunked sequence (5.2a): A is what an accepted
 *  salt leaves behind. */
export interface SeqIn<A> {
  hwm: Dec
  lowerBound: Dec
  assembly: Assembly | null
  accepted: A | null
}

/** One star reconciliation pair (member, anchor head of its entry) (5610). */
export interface StarPair { member: string, head: string }
export type StarOut = SeqOut<StarPair>
export type StarIn = SeqIn<{ salt: Dec, blinded: string[] }>

/** One group-star domain element (5730): member and memberOp present for
 *  sealed entries only, and a change of either diverges (5770). */
export type GroupStarItem =
  | { group: string, mode: 'digest' }
  | { group: string, mode: 'sealed', member: string, memberOp: string }
export type GroupStarOut = SeqOut<GroupStarItem>
/** Received group star: its entries {d, c} as accepted (5.2b). */
export type GroupStarIn = SeqIn<{ salt: Dec, entries: Array<{ d: string, c: string }> }>

/** A chunked document under assembly: chunk index → chunk. */
export interface Assembly { salt: Dec, chunks: Record<string, Json> }

// ── Groups, profile ────────────────────────────────────────────────────

export interface Group {
  /** genesis digest */
  id: string
  /** own member context label in this group */
  memberLabel: string
  /** group rules are group state, never entropy (note §3) */
  rules: { vouchThreshold: Dec }
  /** listed in the blinded group star (5.2b per-group switch) */
  listed: boolean
  /** the holder's Access view of the group, until membership graduates */
  membership: Json | null
}

/** The holder's own profile: one revision counter (6450). */
export interface OwnProfile { body: Json | null, revision: Dec }

// ── Delivery: effects and outbox ───────────────────────────────────────

/** A completed effect with its retained ack (null for a terminal
 *  document): the cache entry and the ack commit together at stage 9 and
 *  expire together at expiresAt = commit + key-retention (Delivery 4.2, §7). */
export interface Effect { ack: StoredAck | null, expiresAt: Millis }

/**
 * The acknowledgement of a completed effect, sealed once inside the
 * effect's transaction and re-sent byte-identical on every duplicate
 * (Delivery 4.2, 6.2 stage 4). Acks are outbox-less: no trias, no retry
 * schedule. `sent` is false until the app reports the ack's digest
 * (any DeliveryReport status); resume re-emits every ack still unsent,
 * which covers a restart between the receive commit and the send.
 */
export interface StoredAck {
  /** the ack document's digest; report() on it marks the ack sent */
  digest: string
  /** sealed to recipient.keyAgreement, as first emitted */
  envelope: Envelope
  threadId: string
  recipient: Recipient
  sent: boolean
}

export type OutboxStatus = 'submitted' | 'accepted' | 'delivered' | 'failed'

/** One step of an item's history. `awaiting-transport` is a pre-transport
 *  report, not a trias state (Delivery §6.1). The holder's own give-up
 *  (RetryPolicy) is recorded as failed(expired-by-adapter-policy). */
export type OutboxStep =
  | { status: 'submitted', at: Millis, attempt: number }
  | { status: 'awaiting-transport', at: Millis, reason: PreTransportReason }
  | { status: 'accepted', at: Millis }
  | { status: 'delivered', at: Millis, late: boolean }
  | { status: 'failed', at: Millis, reason: Exclude<DeliveryFailure, 'rejected-by-receiver'> }
  | { status: 'failed', at: Millis, reason: 'rejected-by-receiver', code: ReceiverRefusalCode }

export interface OutboxItem {
  type: string
  threadId: string
  recipient: Recipient
  /** the envelope as last sent; retries resend it. Its rkid is
   *  recipient.keyAgreement, never the own recipient.rkid. */
  envelope: Envelope
  attempt: number
  /** history, oldest first (Delivery §6.1) */
  history: OutboxStep[]
  nextAttemptAt?: Millis
}

// ── Duties ─────────────────────────────────────────────────────────────

/** Re-issue of the anchor mapping after a rotation (6370): due now, or
 *  waiting until the relationship presents `awaitHead` (6596). */
export interface ReissueMappingDuty { kind: 'reissue-mapping', v: 1, id: string, dueAt?: Millis, contactId: string, relId: string, awaitHead: string | null }
/** Send a class's current artifact on a relationship it turned on for (2850). */
export interface ClassOnDuty { kind: 'class-on', v: 1, id: string, dueAt?: Millis, contactId: string, relId: string, cls: TrustClass }
/** Deliver profile revision `rev` on a relationship (6455). */
export interface ProfileDuty { kind: 'profile', v: 1, id: string, dueAt?: Millis, contactId: string, relId: string, rev: Dec }
/** Continuity resend on a tuple (6830–6850). */
export interface ContinuityDuty { kind: 'continuity', v: 1, id: string, dueAt?: Millis, relId: string, tuple: string, step: 'probe' | 'mapping' }

/** The persisted continuation of a merge (2230): the verification has
 *  committed; these entries merge in one later atomic step. */
export interface MergeDuty { kind: 'merge', v: 1, id: string, dueAt?: Millis, entryIds: string[], relId: string }

// Every duty may carry `dueAt`: resume runs it only from then on and
// counts it into nextDueAt (engine.ts).

export type KnownDuty = ReissueMappingDuty | ClassOnDuty | ProfileDuty | ContinuityDuty | MergeDuty
/** A duty of a kind (or version) this library does not know: kept as is. */
export interface UnknownDuty { kind: string, v: number, id: string, [field: string]: Json }
/** Narrow with isKnownDuty (codec.ts) before switching on `kind`. */
export type Duty = KnownDuty | UnknownDuty

// ── Rotations, prompts, acts, encounter ────────────────────────────────

/**
 * A running rotation; steps in order: register, then log, then duties.
 * The whole append closure is persisted before the append, so a restart
 * repeats or recognizes exactly that append (Log.append idempotence).
 */
export interface Rotation {
  id: string
  from: Dec
  to: Dec
  step: 'register' | 'log' | 'duties'
  startedAt: Millis
  /** the anchor.rotate body, incl. the signed anchor-rotation@2 */
  entry: Json
  /** the log head the entry is appended over */
  overHead: LogHead
  /** relationship id → anchor head the re-issue waits for, null = due at
   *  once; decided at the label commit (6596) */
  awaitHead: Record<string, string | null>
}

export type PromptKind = 'encounter-confirm' | 'group-invite' | 'introduction'
/** The human's answer to a prompt (prompts.ts). */
export type PromptChoice = 'accept' | 'decline'

export interface Prompt {
  id: string
  kind: PromptKind
  contactId?: string
  groupId?: string
  openedAt: Millis
  expiresAt?: Millis
}

/** One journaled human act (note §4.2). */
export interface ActRecord {
  actId: string
  /** digest(JCS(name, input)) */
  inputHash: string
  /** commitSeq of the act's commit */
  commitSeq: Dec
  outboundDigests: string[]
  events: HolderEvent[]
  /** commit time, for retention like effects */
  at: Millis
}

/** Open challenges, records and introduction acts, keyed by id;
 *  opaque until encounter graduates (note §5, PR 7). */
export interface EncounterState {
  challenges: Record<string, Json>
  records: Record<string, Json>
  introductions: Record<string, Json>
}

/** An outbox item's trias position (Delivery §6.1): its last step that is
 *  not pre-transport, `submitted` before any. */
export function triasOf (item: Readonly<OutboxItem>): OutboxStatus {
  for (let i = item.history.length - 1; i >= 0; i--) {
    const s = item.history[i].status
    if (s !== 'awaiting-transport') return s
  }
  return 'submitted'
}

/** A fresh holder's state. */
export function emptyState (codec: number): HolderState {
  return {
    codec,
    commitSeq: '0',
    lastWhen: 0,
    register: { labels: [], pairNonces: {}, carriers: {}, devices: { names: [], revoked: [] }, community: null, lineage: [] },
    addresses: { keys: {}, tombstones: [] },
    contacts: {},
    relationships: {},
    entryOrder: { nextPos: '0', heads: [] },
    groups: {},
    profile: { body: null, revision: '0' },
    effects: {},
    outbox: {},
    duties: {},
    rotations: {},
    prompts: {},
    acts: {},
    encounter: { challenges: {}, records: {}, introductions: {} },
  }
}
