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
// operation of a holder in one queue and commits by CAS, so the lock set
// — the digest, and for star and group-star chunks additionally the
// assembly key (tuple, type, salt) of 4.4 — is held for the whole
// evaluation; a CAS conflict re-reads and re-enters at stage 1, which
// re-checks the cache at stage 4. The chunk types themselves, with the
// completing chunk's effect (validated assembly, accepted snapshot and
// salt advance in the ack's transaction) and one salt = one thread,
// arrive with the star in PR 4 on exactly this path.
//
// Ack class (4.4): every type a module can register here is of the
// designated-verifier class and earns the MAC-form ack; registering a
// signature-class type is refused until the signed-ack path exists (the
// encounter types, PR 7).
import { calOK, iso, makeValidator } from './core.js'
import type { Json } from './core.js'
import { digestDoc, xRawOfMk } from './crypto.js'
import { receiveByAgreement, seal } from './delivery.js'
import type { KeyAnswer } from './delivery.js'
import { ACK_TYPE, ackDocument, ackKeyOf, macAck, macAckForm, macAckValid } from './ack.js'
import { SCHEMAS } from './schemas.js'
import { triasOf } from './state.js'
import type { HolderState, Millis, OutboxItem, Relationship, StoredAck, Tuple } from './state.js'
import type { Outbound } from './ports.js'
import { InfraError } from './results.js'
import type { ReceiveFailure, ReceiveResult, ReceiveStageNo } from './results.js'
import type { EventDraft, PrepareCtx, Prepared } from './engine.js'

// ── the task handler contract ──────────────────────────────────────────

/** Where and when a document arrived: the own rkid it was sealed to, its
 *  thread, its digest and the receive's `when`. */
export interface Arrival { rkid: string, threadId: string, digest: string, when: Millis }

/** Why a task handler refuses a document; the stage follows from where:
 *  decode 'malformed' → 7, decode or prepare otherwise → 8, apply → 9. */
export type TaskFailure = 'malformed' | 'validation-failed' | 'stale-issuance' | 'gate-future' | 'consumed-challenge'

/** A handler's refusal: nothing commits, the digest stays uncached and
 *  a redelivery is evaluated afresh (Delivery 6.2 stage 4). */
export interface TaskRefusal { ok: false, reason: TaskFailure, ref?: string }

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

/** A sealed-and-stored ack as the outbound the app sends; attempt 1 at
 *  its first emission, 2 on every re-send (acks keep no counter). */
export const ackOutbound = (a: Readonly<StoredAck>, attempt: 1 | 2): Outbound =>
  structuredClone({ digest: a.digest, envelope: a.envelope, type: ACK_TYPE, threadId: a.threadId, recipient: a.recipient, attempt })

/** Signature-class types: their acks are signed (4.4), not MACed. */
export const SIGNATURE_CLASS: ReadonlySet<string> = new Set([
  'https://real-life.org/trust-tasks/encounter-bundle/0.1',
  'https://real-life.org/trust-tasks/encounter-credential-delivery/0.1',
])

export const isTaskRefusal = (x: unknown): x is TaskRefusal =>
  x !== null && typeof x === 'object' && (x as TaskRefusal).ok === false && typeof (x as TaskRefusal).reason === 'string'

// ── the plan a preparation hands to stage 9 ────────────────────────────

type Failed = Extract<ReceiveResult, { disposition: 'failed' }>

/** What stages 1–8 decided, bound to the snapshot they ran against. */
export type ReceivePlan =
  | { kind: 'failed', result: Failed }
  | { kind: 'duplicate', digest: string }
  | { kind: 'ack', digest: string, ref: string }
  | { kind: 'task', digest: string, type: string, doc: ReceivedDocument, arrival: Arrival, value: unknown, ack: StoredAck }

/** The handler surface the core needs (engine.ts TaskHandler). */
export interface TaskEntry {
  proof: 'absent' | 'required'
  decode (payload: unknown): unknown
  prepare? (ctx: PrepareCtx, doc: ReceivedDocument, arrival: Arrival): Promise<unknown>
}

const V = makeValidator(SCHEMAS)
const profileOk = (doc: unknown): boolean =>
  V.validate(doc, SCHEMAS['rltp-delivery-document.schema.json'], SCHEMAS['rltp-delivery-document.schema.json']).length === 0 &&
  calOK((doc as { issuedAt?: unknown }).issuedAt)

const failed = (reason: ReceiveFailure, stage: ReceiveStageNo, extra: { digest?: string, key?: 'unknown' | 'retired' } = {}): ReceivePlan =>
  ({ kind: 'failed', result: { disposition: 'failed', reason, stage, ...extra } })

/** The tuple whose own rkid is `rkid`, with its relationship. */
export function tupleByRkid (state: Readonly<HolderState>, rkid: string): { rel: Relationship, tuple: Tuple } | null {
  for (const id of Object.keys(state.relationships).sort()) {
    const rel = state.relationships[id]
    for (const tuple of rel.tuples) if (tuple.rkid === rkid) return { rel, tuple }
  }
  return null
}

/** The arrival tuple's channel ack key (4.2): X25519 of the own key behind
 *  the tuple's rkid and the counterpart key, HKDF under issuer/recipient. */
async function ackKey (ctx: PrepareCtx, tuple: Readonly<Tuple>, issuer: string, recipient: string): Promise<Uint8Array | null> {
  const raw = xRawOfMk(tuple.counterpartKeyAgreement)
  if (!raw) return null
  const a = await ctx.keys.agree(tuple.rkid, raw, ctx.release)
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
  // 6 — the built-in ack path
  if (doc.type === ACK_TYPE) {
    const f = macAckForm(doc)
    if (!f.ok) return failed(f.reason, f.stage, { digest })
    // 8 — consistency against what this holder sent (4.2)
    const item: OutboxItem | undefined = Object.hasOwn(state.outbox, f.ref) ? state.outbox[f.ref] : undefined
    if (!at || doc.issuer !== at.tuple.counterpartAnchor || !item || item.threadId !== f.threadId ||
      item.recipient.rkid !== rkid || SIGNATURE_CLASS.has(item.type)) return failed('validation-failed', 8, { digest })
    const key = await ackKey(ctx, at.tuple, doc.issuer as string, doc.recipient as string)
    if (!key || !(await macAckValid(doc, key, S))) return failed('validation-failed', 8, { digest })
    return { kind: 'ack', digest, ref: f.ref }
  }
  // 6 — the task register, by the full type URI (no prefix, no fallback)
  const h = tasks.get(doc.type as string)
  if (!h) return failed('unknown-type', 6, { digest })
  if ((h.proof === 'absent') !== (doc.proof === undefined)) return failed('validation-failed', 6, { digest })
  // 7–8 — decode, the closed acceptance binding, the handler's preparation
  const payload = h.decode(doc.payload)
  if (isTaskRefusal(payload)) return failed(payload.reason, payload.reason === 'malformed' ? 7 : 8, { digest })
  if (!at || doc.issuer !== at.tuple.counterpartAnchor) return failed('validation-failed', 8, { digest })
  const rdoc = Object.freeze({ ...doc, payload }) as ReceivedDocument
  const arrival: Arrival = Object.freeze({ rkid, threadId: doc.threadId as string, digest, when: ctx.when })
  const value = h.prepare ? await h.prepare(ctx, rdoc, arrival) : undefined
  if (isTaskRefusal(value)) return failed(value.reason, 8, { digest })
  // the ack, sealed before the transaction (4.2: created inside the
  // effect's transaction — it commits with the cache entry or not at all)
  const key = await ackKey(ctx, at.tuple, own.anchor, at.tuple.counterpartAnchor)
  if (!key) return failed('validation-failed', 8, { digest })
  const ackDoc = await macAck(ackDocument({
    id: ctx.entropy.id('ack.id'), issuer: own.anchor, recipient: at.tuple.counterpartAnchor,
    threadId: arrival.threadId, issuedAt: iso(ctx.when), ref: digest,
  }), key, S)
  const envelope = await seal(ackDoc as unknown as Json, at.tuple.counterpartKeyAgreement,
    { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
  const ack: StoredAck = {
    digest: await digestDoc(ackDoc, S), envelope, threadId: arrival.threadId,
    recipient: { contactId: at.rel.contactId, rkid, keyAgreement: at.tuple.counterpartKeyAgreement }, sent: false,
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
