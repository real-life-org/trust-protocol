// receive — the holder's receive core (lib Stage 2, note §4.3; Delivery
// §6.2, §4.2, §4.4). The engine runs it as its built-in `receive`: the
// preparation (async) walks stages 1–8, the transition (sync) is stage 9.
//
//   1–4  once, here, through delivery.receiveByAgreement: the key agreement
//        is the KeyProvider's `agree` under the engine's release from
//        `addresses` (a tombstone answers retired: stage 3; an rkid never
//        issued answers unknown: stage 2); the completed-effect cache is
//        `state.effects`
//   5    the document profile (schema, calendar-valid issuedAt) and
//        recipient = the own anchor of the label the arrival rkid derives
//        under (addresses)
//   6    dispatch by the full type URI with version: the built-in
//        delivery-ack path, else the task register, else unknown-type;
//        then the entry's proof declaration. Delivery §3 wants `proof`
//        absent on every type but delivery-ack and registry-declaration,
//        and §4.4 puts the declaration into the registry entry; the
//        profile schema can name only the types it knows, so for
//        companion types the rule is enforced here, the earliest stage at
//        which the receiver holds the entry: a mismatch is
//        failed(validation-failed)
//   7–8  the handler's decode (malformed at 7, any other refusal at 8),
//        the core's closed acceptance binding (Delivery 4.4: the arrival
//        tuple is selected by rkid, the document's issuer is its
//        counterpart anchor), the handler's prepare, and the ack: sealed
//        here, before the transaction, from fresh entropy
//   9    the handler's apply; the core files the effect-cache entry with
//        the ack in the same commit (the handler never writes `effects`)
//        and hands the ack out first among the outbound
//
// Acks (delivery-ack/0.1) are no registered task: one common path checks
// the form (ack.ts macAckForm), then the consistency of 4.2 against the
// outbox — `ref` is a document this holder sent on that thread, on the
// arrival tuple (outbox item rkid = arrival rkid), the issuer is that
// tuple's counterpart, the referenced document's type is of the
// designated-verifier class (a MAC ack of a signature-class document is
// the wrong class), and the MAC verifies under the arrival tuple's ack
// key. A valid ack marks the item delivered (late after failed) and
// earns a terminal cache entry, no ack of its own.
//
// The stage-9 lock set (Delivery 6.2): the engine serializes every
// operation of a holder in one queue and commits by CAS — a strictly
// stronger serialization than the lock set asks for (it holds every key
// of the holder, not only the overlapping ones), which is how this
// library implements it under Stage 2's one-writer contract. The lock set
// — the digest, and for star and group-star chunks additionally the
// assembly key (tuple, type, salt) of 4.4 — is held for the whole
// evaluation; a CAS conflict re-reads and re-enters at stage 1, which
// re-checks the cache at stage 4. The chunk types (trust/star.ts,
// trust/group-star.ts, PR 4b) need no key of their own here: every
// chunk of one tuple and type is evaluated against, and committed over,
// the one state version its preparation read, so the completing chunk's
// effect (validated assembly, accepted snapshot, completed-salt advance)
// commits with the cache entry and the ack in one transaction.
//
// The lock keys a registering specification adds (Delivery RLTP-DEL-6210
// to 6230): the relationship key of a message or an attributed invitation,
// the holder-wide credential-digest key of every invitation, the
// (genesis digest, inviter) key of the prelude (Membership 3950–3957,
// 3980), and the writers that take them (a block, a chaining, a merge or
// split, a deletion of a completion-record entry or a binding) are all
// held by the same whole-state serialization.
//
// A refusal (TaskRefusal) never commits anything, at any stage. One of
// them is transient: `rate-limited` (Delivery RLTP-DEL-5820, 6270, 6280),
// a document beyond a bound its type declares; it earns no ack and no
// cache entry, the carrier keeps it, and a redelivery is evaluated in
// full. A rate the type places inside stage 9 is checked here in the
// handler's preparation (stage 8), against the snapshot stage 9 commits
// on — the same state, by the CAS above.
//
// A handler's apply may answer a TaskDiscarded: the receiver discarded an
// open assembly and holds its salt as the lower bound (5366), for one of
// two reasons: `resource-limit` (Trust 5365), or `rejected` — an
// authenticated chunk (its MAC verified) violates the assembly rules
// (5260–5310, 5500, 5510), and the spec rejects the whole delivery, so it
// must not complete from any later chunk. That is a spec-mandated state
// effect, not a failure of the document: its state commits and the result
// is the disposition `discarded` with the reason and the rule — no
// effect-cache entry (a redelivery is evaluated afresh and meets the lower
// bound), no ack (the delivery must not complete), no event; the completed
// high-water mark stays. A chunk that does not authenticate is a plain
// refusal and touches nothing. DELIVERY GAP: Delivery §6.2 names no
// disposition for a document whose processing ends in such a discard;
// `discarded` (both reasons) is this library's, to be registered in
// Delivery 0.82.
//
// A verified ack runs the ack handler a module registered for the
// acknowledged item's type, in the ack's transaction (engine.ts
// AckHandler): the sender side of 5660, completion by verified acks only.
//
// Ack class (4.4): the class follows the payload's audience class. The
// types of SIGNATURE_CLASS carry transferable signatures (the encounter
// carriers, the membership documents, the signed introduction artifacts,
// the registry declaration): their ack is SIGNED, an eddsa-jcs-2022 proof
// under the ack's issuer anchor through the KeyProvider (`sign` with the
// arrival key's label). Every other type is designated-verifier and earns
// the MAC form under the channel ack key of the arrival rkid and the
// counterpart key. A received ack is checked in the form its referenced
// outbox item's class selects; the other form is validation-failed.
//
// The acceptance binding before a tuple exists (PR 7): a handler with a
// `channel` binds its document itself, from the document, where it may
// arrive on an own key no tuple carries yet — the encounter bundle on the
// displayed card's key (Delivery 4.1: the bundle establishes the tuple,
// its issuer bound to card.anchor = credential.issuer), the membership
// documents on member keys (Membership 3.1, 3.2). `channel` names the
// counterpart's key agreement the ack is sealed to and the contact it is
// filed under, or refuses (stage 7 for malformed, else 8). Every other
// handler keeps the tuple binding of Delivery 4.4.
import { calOK, iso, makeValidator, toU } from './core.js'
import type { Json } from './core.js'
import { diSignWith, diVerify, digestDoc, xRawOfMk } from './crypto.js'
import { receiveByAgreement, seal } from './delivery.js'
import type { KeyAnswer } from './delivery.js'
import { ACK_TYPE, ackDocument, ackKeyOf, ackProofForm, macAck, macAckForm, macAckValid, signedAckForm } from './ack.js'
import { SCHEMAS } from './schemas.js'
import { triasOf } from './state.js'
import { entryOf, liveRel } from './trust/state.js'
import type { HolderState, Millis, OutboxItem, Relationship, StoredAck, Tuple } from './state.js'

/** An ack as sealed in the preparation; the engine adds its schedule. */
export type SealedAck = Pick<StoredAck, 'digest' | 'envelope' | 'threadId' | 'recipient'>
import type { Outbound } from './ports.js'
import { InfraError } from './results.js'
import type { ReceiveFailure, ReceiveResult, ReceiveStageNo } from './results.js'
import type { EventDraft, PrepareCtx, Prepared } from './engine.js'
import { TASK_NAMESPACE as TT } from './task-uri.js'

// ── the task handler contract ──────────────────────────────────────────

/** Where and when a document arrived: the own rkid it was sealed to, its
 *  thread, its digest and the receive's `when`. */
export interface Arrival { rkid: string, threadId: string, digest: string, when: Millis }

/** Why a task handler refuses a document; the stage follows from where:
 *  decode 'malformed' → 7, decode or prepare otherwise → 8, apply → 9. */
export type TaskFailure = 'malformed' | 'validation-failed' | 'stale-issuance' | 'gate-future' | 'consumed-challenge' | 'rate-limited'

/** A handler's refusal: nothing commits, the digest stays uncached and
 *  a redelivery is evaluated afresh (Delivery 6.2 stage 4) — with one
 *  narrow, enumerated exception, the Encounter aging latch: an apply that
 *  refuses because its authoritative resolution found an own challenge past
 *  its age bound (Encounter 5260, 5270, 5290; Delivery 4.1 check 5) returns
 *  `latch`, the state with that challenge removed, and the engine commits
 *  exactly it (and the raised lastWhen): no cache entry, no ack, no event;
 *  the disposition stays failed. A latch that touches anything beyond
 *  encounter.challenges is a programming error and throws (engine.ts). */
export interface TaskRefusal { ok: false, reason: TaskFailure, ref?: string, latch?: HolderState }

/** A discard at a resource limit (Trust 5365/5366), answered by apply:
 *  `state` commits (assembly dropped, lower bound held), the disposition
 *  is `discarded`, with no cache entry, no ack and no event. */
export interface TaskDiscarded { discarded: true, reason: DiscardReason, state: HolderState, ref?: string }

/** Why an assembly was discarded: a local resource limit (5365), or an
 *  authenticated violation of the assembly rules that rejects the delivery. */
export type DiscardReason = 'resource-limit' | 'rejected'

export const isTaskDiscarded = (x: unknown): x is TaskDiscarded =>
  x !== null && typeof x === 'object' && (x as TaskDiscarded).discarded === true

/** A received document after stage 7: the profile fields, its payload
 *  as the handler's decode returned it. Read-only. */
export interface ReceivedDocument<T = unknown> {
  readonly id: string
  readonly type: string
  readonly issuer: string
  readonly recipient: string
  readonly threadId: string
  readonly issuedAt: string
  readonly payload: T
  readonly ceremony?: Json
  readonly proof?: Json
}

/** A sealed ack as the outbound the app sends, at the given attempt. */
export const ackOutbound = (a: Readonly<SealedAck>, attempt: number): Outbound =>
  structuredClone({ digest: a.digest, envelope: a.envelope, type: ACK_TYPE, threadId: a.threadId, recipient: a.recipient, attempt })

/** Signature-class types (Delivery 4.2/4.4): payloads whose authenticity
 *  is a transferable signature; their acks are signed, not MACed. The
 *  `x-` slugs are this library's own experimental, unregistered forms
 *  for what the specifications leave to the application (the welcome until the Access envelope is
 *  built; the introduction offer that conveys the target designator,
 *  Trust 8.3): signed documents as well. A receiver that does not know
 *  them answers unknown-type (Delivery §6.2). */
export const SIGNATURE_CLASS: ReadonlySet<string> = new Set([
  TT + 'encounter-bundle/0.1',
  TT + 'encounter-credential-delivery/0.1',
  TT + 'membership-invite/0.2',
  TT + 'membership-accept/0.2',
  TT + 'membership-evidence/0.1',
  TT + 'membership-evidence/0.2',
  TT + 'registry-declaration/0.1',
  TT + 'introduction-request/0.1',
  TT + 'introduction-forward/0.1',
  TT + 'introduction-reply/0.1',
  TT + 'membership-prelude-request/0.1',
  TT + 'membership-prelude-reply/0.1',
  // lib 0.4.0's prelude forms: never received any more (unknown-type), kept
  // for the class of an outbox item a codec-1 state still holds, whose
  // signed ack may yet arrive
  TT + 'x-membership-prelude-request/0.1',
  TT + 'x-membership-prelude-reply/0.1',
  TT + 'x-membership-welcome/0.1',
  TT + 'x-introduction-offer/0.1',
])

/** The counterpart a `channel` binding names: the key agreement the ack
 *  is sealed to and the contact it is filed under. */
/** The binding a document arrives under: the counterpart's key and the
 *  contact; `via`, where the arrival key is no tuple's (a member key), the
 *  own rkid of the tuple the contact was named through (Recipient.via). */
export interface Channel { keyAgreement: string, contactId: string, via?: string }

export const isTaskRefusal = (x: unknown): x is TaskRefusal =>
  x !== null && typeof x === 'object' && (x as TaskRefusal).ok === false && typeof (x as TaskRefusal).reason === 'string'

// ── the plan a preparation hands to stage 9 ────────────────────────────

type Failed = Extract<ReceiveResult, { disposition: 'failed' }>

/** What stages 1–8 decided, bound to the snapshot they ran against. */
export type ReceivePlan =
  | { kind: 'failed', result: Failed }
  | { kind: 'duplicate', digest: string }
  | { kind: 'ack', digest: string, ref: string, doc: ReceivedDocument, arrival: Arrival }
  | { kind: 'task', digest: string, type: string, doc: ReceivedDocument, arrival: Arrival, value: unknown, ack: SealedAck }

/** The handler surface the core needs (engine.ts TaskHandler). */
export interface TaskEntry {
  proof: 'absent' | 'required'
  decode (payload: unknown): unknown
  channel? (state: Readonly<HolderState>, doc: ReceivedDocument, rkid: string): Channel | TaskRefusal
  /** may arrive on a deactivated tuple an act pinned (engine TaskHandler) */
  pinned?: true
  prepare? (ctx: PrepareCtx, doc: ReceivedDocument, arrival: Arrival): Promise<unknown>
}

const V = makeValidator(SCHEMAS)
const profileOk = (doc: unknown): boolean =>
  V.validate(doc, SCHEMAS['rltp-delivery-document.schema.json'], SCHEMAS['rltp-delivery-document.schema.json']).length === 0 &&
  calOK((doc as { issuedAt?: unknown }).issuedAt)

const failed = (reason: ReceiveFailure, stage: ReceiveStageNo, extra: { digest?: string, key?: 'unknown' | 'retired', ref?: string } = {}): ReceivePlan =>
  ({ kind: 'failed', result: { disposition: 'failed', reason, stage, ...extra } })

/** The tuple whose own rkid is `rkid`, with its relationship. */
export function tupleByRkid (state: Readonly<HolderState>, rkid: string): { rel: Relationship, tuple: Tuple } | null {
  for (const id of Object.keys(state.relationships).sort()) {
    const rel = state.relationships[id]
    for (const tuple of rel.tuples) if (tuple.rkid === rkid) return { rel, tuple }
  }
  return null
}

/** The arrival channel's ack key (4.2): X25519 of the own key behind
 *  `rkid` and the counterpart key, HKDF under issuer/recipient. */
async function ackKey (ctx: PrepareCtx, rkid: string, counterpartKeyAgreement: string, issuer: string, recipient: string): Promise<Uint8Array | null> {
  const raw = xRawOfMk(counterpartKeyAgreement)
  if (!raw) return null
  const a = await ctx.keys.agree(rkid, raw, ctx.release)
  if (a.status !== 'available') return null
  try { return await ackKeyOf(a.shared, issuer, recipient, ctx.crypto.subtle) } catch { return null }
}

/**
 * Stages 1–8 against the preparation's snapshot. Never throws for
 * anything the envelope carries; port failures surface as InfraError.
 */
export async function prepareReceive (ctx: PrepareCtx, env: unknown, tasks: ReadonlyMap<string, TaskEntry>): Promise<ReceivePlan> {
  const S = ctx.crypto.subtle
  const state = ctx.snapshot
  // 1–4
  const agree = (rkid: string, epk: Uint8Array): Promise<KeyAnswer> => ctx.keys.agree(rkid, epk, ctx.release)
  const r = await receiveByAgreement(env, agree, (d) => Object.hasOwn(state.effects, d), S)
  if (r.disposition === 'duplicate-known') return { kind: 'duplicate', digest: r.digest! }
  if (r.disposition !== 'unique') {
    const stage = r.stages[r.stages.length - 1].stage
    const reason = r.disposition.slice('failed('.length, -1) as ReceiveFailure
    return failed(reason, stage, r.key ? { key: r.key } : {})
  }
  const doc = r.document as Record<string, Json>
  const digest = r.digest!
  const rkid = (env as { rkid: string }).rkid
  // 5 — profile, then recipient = own anchor under the arrival key's label
  if (!profileOk(doc)) return failed('malformed', 5, { digest })
  const release = ctx.release(rkid)
  if (release.status !== 'live') throw new InfraError('key-provider', 'agree answered for an rkid the release does not hold live')
  const own = await ctx.keys.anchorOf(release.label)
  if (doc.recipient !== own.anchor) return failed('wrong-recipient', 5, { digest })
  const at = tupleByRkid(state, rkid)
  // 6 — the built-in ack path, in the form the acked document's class selects
  if (doc.type === ACK_TYPE) {
    const signed = ackProofForm(doc) === 'signed'
    const f = signed ? signedAckForm(doc) : macAckForm(doc)
    if (!f.ok) return failed(f.reason, f.stage, { digest })
    // 8 — consistency against what this holder sent (4.2): the document on
    // that thread, sent from the arrival rkid, of the class the proof form
    // claims; the issuer its recipient (the tuple's counterpart, or the
    // anchor it went to where no tuple carried it)
    // the ref in either rendering (u or z, 4.2) names the outbox item by its digest bytes
    const ref = toU(f.ref) ?? f.ref
    const item: OutboxItem | undefined = Object.hasOwn(state.outbox, ref) ? state.outbox[ref] : undefined
    if (!item || item.threadId !== f.threadId || item.recipient.rkid !== rkid || SIGNATURE_CLASS.has(item.type) !== signed) return failed('validation-failed', 8, { digest })
    const expected = at ? at.tuple.counterpartAnchor : item.recipient.anchor
    if (expected === undefined || doc.issuer !== expected) return failed('validation-failed', 8, { digest })
    if (signed) {
      if (!(await diVerify(doc, doc.issuer as string, S))) return failed('validation-failed', 8, { digest })
    } else {
      const key = await ackKey(ctx, rkid, item.recipient.keyAgreement, doc.issuer as string, doc.recipient as string)
      if (!key || !(await macAckValid(doc, key, S))) return failed('validation-failed', 8, { digest })
    }
    const arrival: Arrival = Object.freeze({ rkid, threadId: doc.threadId as string, digest, when: ctx.when })
    return { kind: 'ack', digest, ref, doc: Object.freeze({ ...doc }) as unknown as ReceivedDocument, arrival }
  }
  // 6 — the task register, by the full type URI (no prefix, no fallback)
  const h = tasks.get(doc.type as string)
  if (!h) return failed('unknown-type', 6, { digest })
  if ((h.proof === 'absent') !== (doc.proof === undefined)) return failed('validation-failed', 6, { digest })
  // 7–8 — decode, the closed acceptance binding, the handler's preparation
  const payload = h.decode(doc.payload)
  const refused = (r: TaskRefusal, stage: ReceiveStageNo): ReceivePlan => failed(r.reason, stage, { digest, ...(r.ref !== undefined ? { ref: r.ref } : {}) })
  if (isTaskRefusal(payload)) return refused(payload, payload.reason === 'malformed' ? 7 : 8)
  const rdoc = Object.freeze({ ...doc, payload }) as ReceivedDocument
  // the binding: the arrival tuple (4.4), or the handler's own channel
  // where its document may arrive before any tuple (4.1, Membership)
  let peer: Channel
  if (h.channel) {
    const c = h.channel(state, rdoc, rkid)
    if (isTaskRefusal(c)) return refused(c, c.reason === 'malformed' ? 7 : 8)
    peer = c
  } else {
    if (!at || doc.issuer !== at.tuple.counterpartAnchor) return failed('validation-failed', 8, { digest })
    // a deactivated tuple takes nothing new (6190, 6240): the arrival tuple is
    // the active head of a live relationship, unless the handler binds its
    // artifacts to the tuples an act pinned before a chaining (8270)
    if (!h.pinned && (!liveRel(at.rel) || at.rel.activeHead !== at.tuple.ownPairLabel)) return failed('validation-failed', 8, { digest, ref: 'RLTP-TRU-6240' })
    // the entry the arrival's relationship sends under (2146), by its current id
    peer = { keyAgreement: at.tuple.counterpartKeyAgreement, contactId: entryOf(state, at.rel)?.id ?? at.rel.contactId }
  }
  const arrival: Arrival = Object.freeze({ rkid, threadId: doc.threadId as string, digest, when: ctx.when })
  const value = h.prepare ? await h.prepare(ctx, rdoc, arrival) : undefined
  if (isTaskRefusal(value)) return refused(value, 8)
  // the ack, sealed before the transaction (4.2: created inside the
  // effect's transaction — it commits with the cache entry or not at all),
  // in the form the document's class selects (4.4)
  const base = ackDocument({
    id: ctx.entropy.id('ack.id'), issuer: own.anchor, recipient: doc.issuer as string,
    threadId: arrival.threadId, issuedAt: iso(ctx.when), ref: digest,
  })
  let ackDoc: Json
  if (SIGNATURE_CLASS.has(doc.type as string)) {
    ackDoc = await diSignWith(own.anchor, (b) => ctx.keys.sign(release.label, b), base as unknown as Record<string, Json>, base.issuedAt, S) as unknown as Json
  } else {
    const key = await ackKey(ctx, rkid, peer.keyAgreement, own.anchor, doc.issuer as string)
    if (!key) return failed('validation-failed', 8, { digest })
    ackDoc = await macAck(base, key, S) as unknown as Json
  }
  const envelope = await seal(ackDoc, peer.keyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
  const ack: SealedAck = {
    digest: await digestDoc(ackDoc, S), envelope, threadId: arrival.threadId,
    recipient: { contactId: peer.contactId, rkid, keyAgreement: peer.keyAgreement, ...(peer.via !== undefined ? { via: peer.via } : {}) },
  }
  return { kind: 'task', digest, type: doc.type as string, doc: rdoc, arrival, value, ack }
}

/** The outbox after a valid ack of `ref` (4.2, 6.1): delivered, late after
 *  failed; unchanged when already delivered. Shared with report(). */
export function markDelivered (state: Readonly<HolderState>, ref: string, when: Millis): { outbox: HolderState['outbox'], event: EventDraft | null } {
  const it = state.outbox[ref]
  if (it.history.some((s) => s.status === 'delivered')) return { outbox: state.outbox, event: null }
  const late = triasOf(it) === 'failed'
  const { nextAttemptAt: _, ...rest } = it
  return {
    outbox: { ...state.outbox, [ref]: { ...rest, history: [...it.history, { status: 'delivered', at: when, late }] } },
    event: { type: 'delivery.status', digest: ref, threadId: it.threadId, status: 'delivered', late },
  }
}

/** Prepared for a handler: its own value under the receive's binding. */
export const handlerPrepared = <P>(p: Prepared<unknown>, value: P): Prepared<P> =>
  Object.freeze({ value, version: p.version, commitSeq: p.commitSeq })
