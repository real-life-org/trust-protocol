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
import type { Json, JsonObject } from './core.js'
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
  /** groups on the way in: the preludes answered and the invitations
   *  received, before a welcome makes them groups (Membership 1.2, 3.1) */
  joining: Joining
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
export type AnchorRotation = JsonObject

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
  /** anchor → every pre-rotation binding held for it, sorted (6610: the
   *  union over the mappings verified on any tuple of the chain; two where
   *  a chaining joined tuples that disagree, a conflict the binding rule
   *  sees, 6605) */
  bindings: Record<string, string[]>
  /** the counterpart's anchor head as last verified */
  heldCounterpartHead: string | null
  /** contact memory and evidence (2280) */
  memory: Record<string, Json>
  /** via: the introducer's contact; viaPin: the own pair label toward it
   *  the act was pinned to (8270), which a split follows (2080) */
  provenance: { kind: 'ceremony' | 'introduced', via?: string, viaPin?: string, at: Millis }
  /** set when this chain was appended into another (6a.4): the fresh
   *  relationship whose tuple a chaining appended to `chainedInto` stays as
   *  a husk without tuples, its id resolving to the chain and its contactId
   *  a chain alias of it (2090) */
  chainedInto: string | null
  /** commitSeq of the first verification commit on this relationship
   *  (2190): its place in entry-commit order among the relationships of
   *  one entry (2100); null before any */
  firstVerified: Dec | null
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
  /** 6a.2: the own probe sequence of this tuple direction (6680), the
   *  probes in flight and whether one completed (its delivery acked) */
  probeOut: ProbeOut
  probeIn: { hwm: Dec, lowerBound: Dec, assembly: Assembly | null }
  /** 6a.4: own continuity-mapping issuance (6300) and the open work on it */
  continuityOut: ContinuityOut
  /** 6a.4: verified continuity mapping; recordPrior frozen by 6290 */
  continuityIn: { rev: Dec, body: Json | null, recordPrior: string | null }
  /** issued anchor mapping (6300) and the anchor it was issued under */
  mappingOut: { rev: Dec, body: Json | null, underAnchor: string | null }
  /** verified anchor mapping, its self and card */
  mappingIn: { rev: Dec, body: Json | null, self: string | null, card: Json | null }
  /** the profile revision last issued in this tuple's scope (6300, 6450):
   *  the one counter's value it went out under, "0" before any */
  profileOut: { rev: Dec }
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

/** A probe's sender state (6680, 6830). */
export interface ProbeOut {
  /** last assigned probe sequence, "0" before the first */
  seq: Dec
  /** probe → its chunks' digests and those acked */
  inflight: Record<string, { digests: string[], acked: string[] }>
  /** a probe completed: the standing probe duty ends (6830) */
  done: boolean
}

export interface ContinuityOut {
  /** last issued revision and body (6300/6310) */
  rev: Dec
  body: Json | null
  /** the MACs of the last issued body: a resend (6840) re-seals the same
   *  artifact without the prior tuple's key */
  proof: Json | null
  /** digests of the documents that carried the last issued body: this
   *  issuance's alone, reset by the next (an ack of an earlier issuance
   *  completes nothing of a later one) */
  sent: string[]
  /** the last issuance is the non-record side's alignment: issued after
   *  the record side's mapping was verified (6930) */
  align: boolean
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
  /** SHA-256 hex of JCS(snapshot), null exactly when snapshot is: the
   *  comparison key of the reconciliation (trust/star.ts viewDigest) */
  snapshotDigest: string | null
  /** salt → the view sent under it, its digest, and its chunks' digests (5660) */
  inflight: Record<string, { view: V[], viewDigest: string, digests: string[], acked: string[] }>
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
/** A completed star as the receiver keeps it (trust/star.ts): its salt,
 *  the whole assembled union of blinded values (sorted), and the entry ids
 *  of the holder's contacts one of whose held anchors it carries (6160),
 *  re-matched whenever the holder comes to hold new anchors. */
export type StarIn = SeqIn<{ salt: Dec, blinded: string[], matches: string[] }>

/** One group-star domain element (5730): member and memberOp present for
 *  sealed entries only, and a change of either diverges (5770). */
export type GroupStarItem =
  | { group: string, mode: 'digest' }
  | { group: string, mode: 'sealed', member: string, memberOp: string }
export type GroupStarOut = SeqOut<GroupStarItem>
/** A completed group star as the receiver keeps it (trust/group-star.ts):
 *  its salt, the whole assembled union of entries {d, c}, and the holder's
 *  groups whose d it holds (5520), sorted; a group joined later is matched
 *  against the union (groupStarRematch). */
export type GroupStarIn = SeqIn<{ salt: Dec, entries: Array<{ d: string, c: string }>, groups: string[] }>

/** A chunked document under assembly: chunk index → chunk. */
export interface Assembly { salt: Dec, chunks: Record<string, Json> }

// ── Groups, profile ────────────────────────────────────────────────────

export interface Group {
  /** genesis digest: the group's identity (Access 3.2) */
  id: string
  /** the group's name, as its genesis names it */
  name: string
  /** the group DID, its address, never its identity (Membership 2.3) */
  did?: string
  /** the signed genesis, as founded or as the welcome carried it */
  genesis?: JsonObject
  /** own member context label in this group: the founding pair label for
   *  the founder (Access 3.4.1), group/<digest> for a member (5.1) */
  memberLabel: string
  /** group rules are group state, never entropy (note §3) */
  rules: { vouchThreshold: Dec }
  /** listed in the blinded group star (5.2b per-group switch) */
  listed: boolean
  /** the own member anchor in G (the anchor of memberLabel) and the oid
   *  naming its canonical admission, or the genesis where the holder
   *  founded G (5400). Required on a listed group (codec.ts): membership
   *  sets them on join; only an unlisted group may lack them. */
  memberAnchor?: string
  memberOp?: string
  /** the members this holder knows of, by member anchor: its local view
   *  (membership/*); the replicated log is the Access port's */
  roster: Record<string, RosterEntry>
  /** invitations this holder issued and not yet saw answered, by thread
   *  (Membership 3.1: the invite opens its thread) */
  invitations: Record<string, OpenInvitation>
  /** consent pairs held toward an admission, by the accept document's
   *  digest, with the vouches for it (Membership 3.4, Access 4.2) */
  evidence: Record<string, Evidence>
  /** preludes this holder sent for the group and awaits the answer of, by
   *  thread: the contact and the own rkid of the tuple it went on */
  preludes: Record<string, { contactId: string, rkid: string, at: Millis }>
  /** the own accept's document digest, where the holder joined by one:
   *  the vouches for it bind it (Access 5.3) */
  acceptDigest?: string
}

/** A member as this holder knows it (Membership 2.6: the enclosed card). */
export interface RosterEntry {
  /** member anchor */
  anchor: string
  /** the oid naming its admission (the accept's digest in this library's
   *  welcome form), or the genesis digest for the founder */
  op: string
  /** its card's key agreement: what a document to it is sealed to */
  keyAgreement: string
  /** its card's display name, self-declared (Encounter 6120) */
  name?: string
  addedAt: Millis
  /** the contact this holder knows the member as, where it does */
  contactId?: string
  /** with contactId: the own rkid of the tuple that named the member as
   *  that contact (its invitation's prelude), which a split follows (2080) */
  rkid?: string
}

/** An invitation issued (Membership 3.1): the invite document as sent. */
export interface OpenInvitation {
  /** the invitee's member anchor (credentialSubject.id) */
  invitee: string
  /** the invitee's member key agreement, from the prelude */
  keyAgreement: string
  contactId: string
  /** the own rkid of the tuple the prelude went on, which a split follows (2080) */
  rkid: string
  threadId: string
  /** the invitation's identity: its credential digest (RLTP-MT-2180) */
  credDigest: string
  invite: JsonObject
  validUntil: Millis
}

/** A consent pair held toward an admission (Membership 3.4). */
export interface Evidence {
  /** the invite and the accept documents, complete */
  invite: JsonObject
  accept: JsonObject
  /** vouch@2 credentials for this accept, at most 16 (3805) */
  vouches: JsonObject[]
  at: Millis
}

/** Groups on the way in (Membership 1.2, 3.1, 3.2). */
export interface Joining {
  /** preludes answered, by `<genesis digest> <inviter member anchor>`:
   *  which contact asked as which inviter, so the invite that follows from
   *  that anchor is surfaced as that contact's */
  /** by (group, inviter): the contact and the own rkid of the tuple the
   *  prelude arrived on, the binding a later prelude is held against */
  preludes: Record<string, { group: string, inviter: string, contactId: string, rkid: string, memberLabel: string, at: Millis }>
  /** invitations received, by credential digest */
  invites: Record<string, ReceivedInvite>
}

/** An invitation received (Membership 3.1), surfaced as a group-invite prompt. */
export interface ReceivedInvite {
  credDigest: string
  /** genesis digest */
  group: string
  name: string
  contactId: string
  /** the own rkid of the tuple its prelude arrived on, which a split follows (2080) */
  rkid: string
  memberLabel: string
  /** the invite document, complete */
  invite: JsonObject
  promptId: string
  validUntil: Millis
  status: 'open' | 'accepted' | 'declined' | 'joined'
  /** the accept's document digest, once sent */
  acceptDigest?: string
  at: Millis
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
 * (Delivery 4.2, 6.2 stage 4). Acks are outbox-less: no trias. Until the
 * app reports the ack's digest (any DeliveryReport status) it is unsent
 * and resume re-offers it on the retry policy like an outbox item
 * (attempt, nextAttemptAt, backoff), which covers a restart between the
 * receive commit and the send. At the horizon (at + horizonMs) the holder
 * stops offering it: `sent` with `sentBy: 'horizon'`; a redelivery of the
 * document still earns it (duplicate-known).
 */
export interface StoredAck {
  /** the ack document's digest; report() on it marks the ack sent */
  digest: string
  /** sealed to recipient.keyAgreement, as first emitted */
  envelope: Envelope
  threadId: string
  recipient: Recipient
  /** commit time of the effect, the first emission; the horizon counts from it */
  at: Millis
  /** emissions on the retry schedule so far (duplicates' re-sends excluded) */
  attempt: number
  /** next re-offer while unsent */
  nextAttemptAt?: Millis
  sent: boolean
  /** why it counts as sent: the app reported it, or the horizon passed */
  sentBy?: 'report' | 'horizon'
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
export interface ContinuityDuty {
  kind: 'continuity', v: 1, id: string, dueAt?: Millis, relId: string, tuple: string, step: 'probe' | 'mapping'
  /** sends so far under this standing duty (the issuance counts) */
  attempt?: number
  /** when the last of them was sent: the next is due no earlier than
   *  lastAt + backoff(attempt), a failure included */
  lastAt?: Millis
}

/** The persisted continuation of a merge (2230): the verification has
 *  committed; these entries merge in one later atomic step. */
export interface MergeDuty {
  kind: 'merge', v: 1, id: string, dueAt?: Millis, entryIds: string[], relId: string
  /** what the merge was admitted against (6540, 6550, 6605): each entry's
   *  anchor head, and per entry the other entries' heads it then held as
   *  superseded. The duty runs only while this still holds */
  witness: { heads: Record<string, string>, superseded: Record<string, string[]> }
}

/** The mediator's one ack of an act, at t_received + ack-delay (Trust 8640). */
export interface IntroAckDuty { kind: 'intro-ack', v: 1, id: string, dueAt?: Millis, act: string }

/** Step 2 of a running rotation (identity-state.ts): its log append, on
 *  resume, until the log holds the entry; after a failure due again after
 *  the retry backoff (attempt, lastAt). */
export interface RotationDuty { kind: 'rotation', v: 1, id: string, dueAt?: Millis, rotationId: string, attempt?: number, lastAt?: Millis }

// Every duty may carry `dueAt`: resume runs it only from then on and
// counts it into nextDueAt (engine.ts).

export type KnownDuty = ReissueMappingDuty | ClassOnDuty | ProfileDuty | ContinuityDuty | MergeDuty | RotationDuty | IntroAckDuty
/** A duty of a kind (or version) this library does not know: kept as is. */
export interface UnknownDuty { kind: string, v: number, id: string, [field: string]: Json }
/** Narrow with isKnownDuty (codec.ts) before switching on `kind`. */
export type Duty = KnownDuty | UnknownDuty

// ── Rotations, prompts, acts, encounter ────────────────────────────────

/**
 * A running rotation (identity-state.ts); steps in order: register, then
 * log, then duties. Step 1 commits the register's label and the whole
 * append closure with step 'log', so a restart repeats or recognizes
 * exactly that append (Log.append idempotence); the completion commits the
 * head, the lineage and the re-issue duties and removes the record.
 * 'register' and 'duties' name no state a commit leaves behind today.
 */
export interface Rotation {
  /** the generation it moves to, as a decimal string */
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

/** Open challenges, enactment records and introduction acts (note §2.1). */
export interface EncounterState {
  /** own challenge values still held open (Encounter 5.3), by value */
  challenges: Record<string, OwnChallenge>
  /** enactment records (5.5), by the own challenge value: the consumed-
   *  challenge history, kept for the life of the relation (5360) */
  records: Record<string, EnactmentRecord>
  /** introduction acts (Trust §8), by `<role>:<act id>`: per role (8320) */
  introductions: Record<string, IntroAct>
  /** introductions offered to this holder by a mediator, by prompt id */
  offers: Record<string, IntroOffer>
  /** the mediator's target designators (8610): designator → contact id */
  designators: Record<string, string>
  /** registry declarations held (Delivery §4.4), by `<issuer> <role>` */
  declarations: Record<string, HeldDeclaration>
}

/** The roles of an introduction act (Trust §8). */
export type IntroRole = 'requester' | 'mediator' | 'target'

/** One role's view of one introduction act (8.1): its own lifecycle,
 *  its pins and what 8200 retains, until the absolute lifetime (8310). */
export interface IntroAct {
  /** `<role>:<act>` */
  key: string
  act: string
  role: IntroRole
  /** requester: sent, acked, completed, failed; mediator: received,
   *  forwarded, completed; target: received, consented, refused (8330–8380) */
  status: 'sent' | 'acked' | 'completed' | 'failed' | 'received' | 'forwarded' | 'consented' | 'refused'
  /** the request's issuedAt: the act's lifetime datum (8090) */
  issuedAt: Millis
  /** the request artifact and its card; the reply and its card (8200) */
  request: JsonObject
  requestCard: JsonObject
  reply: JsonObject | null
  replyCard: JsonObject | null
  /** the pinned tuples, by own pair label (8270): the requester's and the
   *  target's toward the mediator, the mediator's toward each side */
  pins: { requester?: string, target?: string, mediator?: string }
  /** the threads: the request's (requester ↔ mediator) and the forward's (mediator ↔ target) */
  threads: { request: string, forward?: string }
  /** requester: its send (t_sent); mediator: entering received; target: the forward's arrival */
  at: Millis
  /** the ack-delay the role computes with (8.4, Delivery §4.4) */
  ackDelayMs: number
  /** the own fresh pair label of the act (requester, target) */
  ownLabel: string | null
  /** mediator: the one ack value produced (8640) */
  ack: JsonObject | null
  /** mediator: the reply forwarded and the vouchers sent (8360) */
  replyForwarded: boolean
  vouchersSent: boolean
  /** requester, target: a voucher held pending its reply (8770) */
  pendingVoucher: JsonObject | null
  /** requester, target: the accepted voucher, retained until the absolute
   *  lifetime for the duplicate rule (8200, 8260) */
  voucher: JsonObject | null
  vouched: boolean
  /** target: the prompt asking for consent */
  promptId: string | null
  /** requester: the target's name as the offer carried it */
  peerName?: string
}

/** An introduction offered by a mediator (this library's offer form). */
export interface IntroOffer {
  /** the prompt's id */
  id: string
  mediatorContactId: string
  /** the own pair label toward the mediator, pinned at send (8270) */
  pin: string
  /** the mediator's opaque designator of the target (8610) */
  target: string
  /** a label the mediator's human typed in the introduce act */
  label?: string
  at: Millis
}

/** A registry declaration held for an (issuer, role) (Delivery §4.4). */
export interface HeldDeclaration { issuer: string, role: string, revision: Dec, constants: Record<string, string>, at: Millis }

/** An own challenge value issued on a displayed card (5.3). */
export interface OwnChallenge {
  value: string
  /** issuance time t_ch */
  tCh: Millis
  /** the fresh pair label the card is shown under (4.4) */
  label: string
  /** the displayed card: the optical payload */
  card: JsonObject
}

/** A step credential with its credential digest (5.6 step 8). */
export interface HeldCredential { digest: string, credential: JsonObject }

/** The enactment record (5.5), keyed by the own challenge value. Its
 *  tuple is the relationship `relId` under the own pair label `label`. */
export interface EnactmentRecord {
  ceremony: string
  /** the own challenge value (the record key) and its issuance time */
  own: string
  tCh: Millis
  /** the counterparty's challenge value */
  peer: string
  /** the counterparty anchor and its card as received */
  counterpart: string
  card: JsonObject
  /** the enactment binding (5.4) */
  bind: string
  /** local time of the enactment */
  at: Millis
  label: string
  relId: string
  /** who scanned (sent the bundle) and who displayed */
  role: 'scanner' | 'displayer'
  /** the own step credential issued, and the counterparty's accepted,
   *  per direction (5.6 step 8) */
  out: HeldCredential | null
  in: HeldCredential | null
  /** the thread of the bundle that opened the exchange and that bundle's
   *  digest (Delivery 4.1); null on the displayer until a bundle landed */
  thread: string | null
  bundleDigest: string | null
  /** later threads used under this record: a re-issued bundle's (its
   *  digest) or a standalone delivery's, threadId → document digest */
  threads: Record<string, string>
  /** the scanner's sent card: the optical leg's payload (5.8) */
  sentCard: JsonObject | null
  /** the displayer issued its counter credential on the optical leg
   *  before the bundle landed: its document waits for the thread (5780) */
  counterPending: boolean
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
    encounter: { challenges: {}, records: {}, introductions: {}, offers: {}, designators: {}, declarations: {} },
    joining: { preludes: {}, invites: {} },
  }
}
