// message/holder — Message Tasks 0.1 on the holder (lib 0.5.0): the
// message (Sections 3 to 5), the block of a relationship (Section 6) and
// the rates per relationship (4.2).
//
// What it registers (messageModule):
//   human acts  message.send {contactId, text, replyTo?}   a message@1 on
//               the active head of a ready, unblocked relationship of the
//               contact (5010–5030), its document carrying the sender
//               lifetime sentAt + H − P1D (5110, Delivery RLTP-DEL-7020);
//               event message.sent {contactId, mid, digest}
//               message.block {contactId, blocked}   sets or clears the
//               block on every relationship of the contact's entry
//               (RLTP-MSG-6020); event contact.blocked
//   not human   message.take {ids}   the application took the inbox
//               entries over durably (4420): they leave the inbox
//   task        message/0.1 (proof absent, designated-verifier: a MAC ack)
//   accepted    the arrival tuple is ready once a document of its
//               counterpart was accepted on it (5.1)
//   retain      completion-record entries past sentAt + H, or of a tuple
//               deactivated or gone (4340); ready marks of tuples gone
//
// Reception (Section 4): stage 7 the schema (4010), stage 8 the calendar
// (3030), the MAC under k_msg of the arrival tuple (4020; issuer and
// recipient are the tuple's pair anchors by the core's binding, which also
// refuses a tuple that is no active head, 4030), and the bounds of 4110
// counted before the block (4130): failed(rate-limited), transient (4120,
// 4140). Stage 9, on t_ref = the receive's time raised to `lastWhen`: the
// age bound (4040, failed(stale-issuance)) and the future bound (4050),
// the completion record (4320: no new effect and a fresh ack; 4330: a
// different body under a known mid is validation-failed), then the
// defined effect in one transaction with the cache entry and the ack
// (4210): the record entry, and an inbox entry unless the relationship is
// blocked (6210, 6220: discard).
//
// What the other modules read through here (pure):
//   blockedRel(state, relId)        the block of one relationship (6010)
//   relOfRkid(state, rkid)          the relationship an own tuple key belongs
//                                   to now, through its tuple (attribution,
//                                   6110; Membership RLTP-MT-3940)
//   rateCount / withRate            the acceptance times a rate counts in the
//                                   24 hours before `when` (4110, 4115)
//   blockedContact(state, id)       whether any relationship of an entry is
//                                   blocked (the outbound refusal of 6410)
//
// Choices this file makes where the specification leaves them open:
//   - the time mark of 4060 is the engine's `lastWhen`: never lowered,
//     written by every commit, and read once per transaction (`when` is
//     raised to it); the CAS commits only on the state it read, so an
//     acceptance and a deletion that race are serialized and the later one
//     decides on the mark the earlier wrote (#103)
//   - readiness (5020) is a refusal, not a queue: message.send answers
//     `not-ready` and the application keeps the message unsent until the
//     contact view says canMessage; the library holds no drafts
//   - the completion record is per tuple and inbound direction (4310), as
//     the rule says: after a chaining, a body sent again on the new head's
//     tuple, under its own key, is a new message there — the guarantee of
//     one effect per mid holds per tuple, not per relationship
//   - replyTo (5120) is the application's: the library keeps no history of
//     sent mids to check it against, and a receiver never rejects it
//   - the block is kept beside the relationships, by relationship id
//     (`messages.blocked`): the chain's id survives a chaining (6030: the
//     chain keeps its block, and takes the block of the fresh relationship
//     it absorbs, trust/continuity.ts) and stays with the relationship through a
//     merge and a split; trust/entries.ts sets it on every relationship of
//     a merged entry where one held it (6030) and drops it with a departed
//     relationship
//   - the lock keys (Delivery RLTP-DEL-6210–6230, Message Tasks 4230,
//     4240, 6330): the engine serializes every operation of a holder in
//     one queue and commits by CAS over the whole state, re-entering at
//     stage 1 on a conflict (receive.ts), which holds every key a rule
//     names and decides on the state read after the wait
//   - a rate keeps only the times inside the window, pruned when it is
//     written; at most the bound's number of entries per relationship
//   - the inbox bound counts the entries of the relationship the arrival
//     tuple belongs to now, before the block (4130); a message whose mid
//     the record holds adds no entry and is not refused by it; under a
//     block a message that passed it is discarded, an entry taken over at
//     once
//   - readiness (5.1) is marked by the accepted hook for every unique
//     document of the counterpart on the arrival tuple, its task
//     documents and its verified delivery-acks alike
//   - which types a block treats (Delivery RLTP-DEL-6245): message/0.1
//     (Message Tasks), membership-invite/0.2 and the prelude reply
//     (Membership 0.20, RLTP-MT-3115, 3975). The Trust Layer types of the
//     table of 6.3 (the introduction's, the profile, the stars, the
//     anchor mapping) are evaluated as without a block until the Trust
//     Layer's casting takes the change up (RLTP-MSG-6240); the views mark
//     a blocked contact so an application shows nothing of it (6230)
import type { CommandDef, HolderModule, OutboundDraft, Refusal, TaskHandler } from '../engine.js'
import type { HolderState, InboxEntry, Millis, Rates, Relationship, Tuple } from '../state.js'
import type { JsonObject } from '../core.js'
import { activeTuple, entryOf, findContact, liveRel, tupleByLabel } from '../trust/state.js'
import { tupleByRkid } from '../receive.js'
import type { Arrival, ReceivedDocument, TaskRefusal } from '../receive.js'
import { calOK, iso } from '../core.js'
import { digestDoc, xRawOfMk } from '../crypto.js'
import { seal } from '../delivery.js'
import {
  INBOX_BOUND, MESSAGE_FUTURE_MS, MESSAGE_LIFETIME_MS, MESSAGE_RATE, MESSAGE_SENDER_LIFETIME_MS, MESSAGE_TYPE,
  messageKeyOf, messageMac, messageShapeOk,
} from '../message.js'
import type { MessageBody, MessagePayload } from '../message.js'

export const MESSAGE_COMMANDS = Object.freeze({ send: 'message.send', block: 'message.block', take: 'message.take' } as const)

/** The rate window of Message Tasks 4.2: any 24 hours. */
export const RATE_WINDOW = 86_400_000
/** At most 20 invitations with a new credential digest per relationship
 *  and window (RLTP-MSG-4115, Membership RLTP-MT-3105). */
export const INVITE_RATE = 20

export interface BlockInput { contactId: string, blocked: boolean }
export interface SendInput { contactId: string, text: string, replyTo?: string }
export interface TakeInput { ids: string[] }

const no = (code: Refusal['code'], ref?: string): Refusal => ({ ok: false, code, ...(ref ? { ref } : {}) })
const refuse = (reason: TaskRefusal['reason'], ref?: string): TaskRefusal => ({ ok: false, reason, ...(ref ? { ref } : {}) })
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Whether the relationship is blocked (RLTP-MSG-6010). */
export const blockedRel = (state: Readonly<HolderState>, relId: string): boolean => state.messages.blocked.includes(relId)

/** The relationship id the own tuple key `rkid` belongs to now, or null. */
export const relOfRkid = (state: Readonly<HolderState>, rkid: string): string | null => tupleByRkid(state, rkid)?.rel.id ?? null

/** Whether any relationship of the entry `id` names (by id or alias) is blocked. */
export const blockedContact = (state: Readonly<HolderState>, id: string): boolean => {
  const c = findContact(state, id)
  return c !== undefined && c.relIds.some((r) => blockedRel(state, r))
}

/** The blocked set with `relIds` set or cleared, sorted. */
export const withBlocked = (blocked: readonly string[], relIds: readonly string[], on: boolean): string[] =>
  (on ? [...new Set([...blocked, ...relIds])] : blocked.filter((r) => !relIds.includes(r))).sort(cmp)

/** The acceptance times of `kind` on the relationship inside the window before `when`. */
export const rateCount = (state: Readonly<HolderState>, relId: string, kind: keyof Rates, when: Millis): number =>
  (Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId][kind] : []).filter((t) => t > when - RATE_WINDOW).length

/** The state with one more acceptance of `kind` on the relationship at `when`, the window pruned. */
export function withRate (state: Readonly<HolderState>, relId: string, kind: keyof Rates, when: Millis): HolderState {
  const held: Rates = Object.hasOwn(state.messages.rates, relId) ? state.messages.rates[relId] : { invites: [], messages: [] }
  const next: Rates = { ...held, [kind]: [...held[kind].filter((t) => t > when - RATE_WINDOW), when] }
  return { ...state, messages: { ...state.messages, rates: { ...state.messages.rates, [relId]: next } } } as HolderState
}

/** The message state without the relationships `relIds` (a departure). */
export function withoutRelationships (state: Readonly<HolderState>, relIds: readonly string[]): HolderState {
  if (!relIds.some((r) => blockedRel(state, r) || Object.hasOwn(state.messages.rates, r))) return state as HolderState
  const rates = { ...state.messages.rates }
  for (const r of relIds) delete rates[r]
  return { ...state, messages: { ...state.messages, blocked: state.messages.blocked.filter((r) => !relIds.includes(r)), rates } } as HolderState
}

// ── the message: sending (Section 5) ───────────────────────────────────

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Whether the tuple is ready (5.1): a document of its counterpart was accepted on it. */
export const tupleReady = (state: Readonly<HolderState>, label: string): boolean => state.messages.ready.includes(label)

/** The relationships a message to the entry may go on: live, their active
 *  head feeding the entry (5010), in the entry's order. */
function channelsOf (state: Readonly<HolderState>, contactId: string): Array<{ rel: Relationship, tuple: Tuple }> | null {
  const c = findContact(state, contactId)
  if (!c) return null
  const ids = new Set([c.id, ...c.aliases])
  const out: Array<{ rel: Relationship, tuple: Tuple }> = []
  for (const id of c.relIds) {
    const rel = state.relationships[id]
    const t = rel && liveRel(rel) ? activeTuple(rel) : undefined
    if (t && !t.deactivated && ids.has(t.entryId)) out.push({ rel, tuple: t })
  }
  return out
}

/** Where a message to the contact goes now, or why it cannot (5010–5030):
 *  the first unblocked, ready channel. */
export function messageChannel (state: Readonly<HolderState>, contactId: string): { rel: Relationship, tuple: Tuple } | Refusal {
  const all = channelsOf(state, contactId)
  if (all === null) return no('unknown-contact')
  if (!all.length) return no('no-own-channel', 'RLTP-MSG-5010')
  const open = all.filter((x) => !blockedRel(state, x.rel.id))
  if (!open.length) return no('blocked', 'RLTP-MSG-5030')
  return open.find((x) => tupleReady(state, x.tuple.ownPairLabel)) ?? no('not-ready', 'RLTP-MSG-5020')
}

interface SendPrep { draft: OutboundDraft, mid: string, contactId: string }

const isRefusal = (x: unknown): x is Refusal => (x as Refusal)?.ok === false

const sendDef: CommandDef<SendInput, SendPrep | Refusal> = {
  human: true,
  async prepare (ctx, input) {
    if (typeof input?.contactId !== 'string' || typeof input.text !== 'string') throw new TypeError('message.send needs {contactId, text}')
    const n = [...input.text].length
    if (n < 1 || n > 4096 || (input.replyTo !== undefined && (typeof input.replyTo !== 'string' || !UUID4.test(input.replyTo)))) return no('message-invalid', 'RLTP-MSG-3020')
    const s = ctx.snapshot
    const ch = messageChannel(s, input.contactId)
    if (isRefusal(ch)) return ch
    const S = ctx.crypto.subtle
    const own = await ctx.keys.anchorOf(ch.tuple.ownPairLabel)
    const raw = xRawOfMk(ch.tuple.counterpartKeyAgreement)
    const a = raw ? await ctx.keys.agree(ch.tuple.rkid, raw, ctx.release) : null
    if (!a || a.status !== 'available') return no('no-own-channel', 'RLTP-MSG-3110')
    const key = await messageKeyOf(a.shared, own.anchor, ch.tuple.counterpartAnchor, S)
    // sentAt in whole seconds (3030), the sender's clock
    const sec = Math.floor(ctx.when / 1000) * 1000
    const body: MessageBody = {
      type: 'message@1', mid: ctx.entropy.id('message.mid'), sentAt: iso(sec), text: input.text,
      ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
    }
    const payload: MessagePayload = { body, proof: { mac: await messageMac(key, body, S) } }
    const doc = {
      id: ctx.entropy.id('doc.id'), type: MESSAGE_TYPE, issuer: own.anchor, recipient: ch.tuple.counterpartAnchor,
      threadId: ctx.entropy.id('thread.id'), issuedAt: iso(ctx.when), payload,
    }
    const envelope = await seal(doc as never, ch.tuple.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
    const contactId = entryOf(s, ch.rel)?.id ?? ch.rel.contactId
    return {
      mid: body.mid, contactId,
      draft: {
        digest: await digestDoc(doc, S), envelope, type: MESSAGE_TYPE, threadId: doc.threadId,
        recipient: { contactId, rkid: ch.tuple.rkid, keyAgreement: ch.tuple.counterpartKeyAgreement },
        // the sender's give-up a day before the age bound (5110, Delivery 7020)
        expiresAt: sec + MESSAGE_SENDER_LIFETIME_MS,
      },
    }
  },
  apply (state, prepared) {
    const p = prepared.value
    if (isRefusal(p)) return p
    return { state: state as HolderState, outbound: [p.draft], events: [{ type: 'message.sent', contactId: p.contactId, mid: p.mid, digest: p.draft.digest }] }
  },
}

// ── the message: reception (Section 4) ─────────────────────────────────

/** The inbox entries of the relationship `relId` (through their tuples now). */
const inboxCount = (state: Readonly<HolderState>, relId: string): number =>
  Object.values(state.messages.inbox).filter((e) => tupleByLabel(state, e.tuple)?.rel.id === relId).length

const messageTask: TaskHandler<MessagePayload, { bodyDigest: string }> = {
  proof: 'absent',
  // stage 7: the closed form (4010); the calendar is a verifier's check (3030)
  decode (p) {
    if (!messageShapeOk(p)) return refuse('malformed', 'RLTP-MSG-4010')
    return calOK(p.body.sentAt) ? p : refuse('validation-failed', 'RLTP-MSG-3030')
  },
  async prepare (ctx, doc, arr) {
    const s = ctx.snapshot
    const S = ctx.crypto.subtle
    const at = tupleByRkid(s, arr.rkid)!
    // the MAC under k_msg of the arrival tuple, issuer to recipient (4020, 3110, 3120)
    const raw = xRawOfMk(at.tuple.counterpartKeyAgreement)
    const a = raw ? await ctx.keys.agree(arr.rkid, raw, ctx.release) : null
    if (!a || a.status !== 'available') return refuse('validation-failed', 'RLTP-MSG-4020')
    let key: Uint8Array
    try { key = await messageKeyOf(a.shared, doc.issuer, doc.recipient, S) } catch { return refuse('validation-failed', 'RLTP-MSG-3120') }
    if ((await messageMac(key, doc.payload.body, S)) !== doc.payload.proof.mac) return refuse('validation-failed', 'RLTP-MSG-4020')
    // the bounds (4110), counted before the block (4130): transient (4120)
    const relId = at.rel.id
    if (rateCount(s, relId, 'messages', ctx.when) >= MESSAGE_RATE) return refuse('rate-limited', 'RLTP-MSG-4110')
    // the inbox bound is counted before the block too (4130): a new mid
    // meets the entries held, blocked or not; once it passes, a block
    // discards it, an entry taken over at once
    const known = s.messages.records[at.tuple.ownPairLabel]?.[doc.payload.body.mid] !== undefined
    if (!known && inboxCount(s, relId) >= INBOX_BOUND) return refuse('rate-limited', 'RLTP-MSG-4110')
    return { bodyDigest: await digestDoc(doc.payload.body, S) }
  },
  // stage 9, on t_ref = arr.when (raised to lastWhen, the mark of 4060)
  apply (state, prepared, doc, arr) {
    const at = tupleByRkid(state, arr.rkid)!
    const label = at.tuple.ownPairLabel
    const relId = at.rel.id
    const body = doc.payload.body
    const tRef = arr.when
    const sentAt = Date.parse(body.sentAt)
    if (sentAt + MESSAGE_LIFETIME_MS < tRef) return refuse('stale-issuance', 'RLTP-MSG-4040')
    if (sentAt > tRef + MESSAGE_FUTURE_MS) return refuse('validation-failed', 'RLTP-MSG-4050')
    const { bodyDigest } = prepared.value
    const held = Object.hasOwn(state.messages.records, label) && Object.hasOwn(state.messages.records[label], body.mid) ? state.messages.records[label][body.mid] : undefined
    if (held && held.bodyDigest !== bodyDigest) return refuse('validation-failed', 'RLTP-MSG-4330')
    // the rate counts every new document digest accepted, before the block (4110, 4130)
    let next = withRate(state, relId, 'messages', tRef)
    // a known mid with its body: no new effect, a fresh ack (4320)
    if (held) return { state: next }
    const records = { ...next.messages.records, [label]: { ...(next.messages.records[label] ?? {}), [body.mid]: { bodyDigest, sentAt } } }
    next = { ...next, messages: { ...next.messages, records } }
    // under a block: discard — the record, the cache entry and the ack, nothing else (6210, 6220)
    if (blockedRel(state, relId)) return { state: next }
    const entry: InboxEntry = { id: arr.digest, tuple: label, mid: body.mid, body: body as unknown as JsonObject, receivedAt: tRef, displayAt: Math.min(sentAt, tRef) }
    const contactId = entryOf(state, at.rel)?.id ?? at.rel.contactId
    return {
      state: { ...next, messages: { ...next.messages, inbox: { ...next.messages.inbox, [entry.id]: entry } } },
      events: [{ type: 'message.received', contactId, inboxId: entry.id }],
    }
  },
}

/** The application took inbox entries over durably (4420). */
const takeDef: CommandDef<TakeInput, null> = {
  human: false,
  apply (state, _p, input) {
    if (!Array.isArray(input?.ids) || !input.ids.every((x) => typeof x === 'string')) throw new TypeError('message.take needs {ids: string[]}')
    const gone = input.ids.filter((id) => Object.hasOwn(state.messages.inbox, id))
    if (!gone.length) return { state: state as HolderState }
    const inbox = { ...state.messages.inbox }
    for (const id of gone) delete inbox[id]
    // the completion record stays (4350)
    return { state: { ...state, messages: { ...state.messages, inbox } } }
  },
}

/** The tuple a counterpart's document was accepted on is ready (5.1). */
function markReady (state: Readonly<HolderState>, doc: ReceivedDocument, arr: Arrival): HolderState {
  const at = tupleByRkid(state, arr.rkid)
  if (!at || doc.issuer !== at.tuple.counterpartAnchor || tupleReady(state, at.tuple.ownPairLabel)) return state as HolderState
  const ready = [...state.messages.ready, at.tuple.ownPairLabel].sort(cmp)
  return { ...state, messages: { ...state.messages, ready } }
}

/** The completion record's retention (4340): an entry leaves once
 *  t_ref (tick's time, written as the mark) lies after sentAt + H, or once
 *  its tuple is deactivated or gone; ready marks of tuples gone leave. */
function retainMessages (state: Readonly<HolderState>, when: Millis): HolderState {
  let changed = false
  const records: HolderState['messages']['records'] = {}
  for (const [label, rec] of Object.entries(state.messages.records)) {
    const t = tupleByLabel(state, label)
    if (!t || t.tuple.deactivated) { changed = true; continue }
    const keep = Object.entries(rec).filter(([, e]) => !(e.sentAt + MESSAGE_LIFETIME_MS < when))
    if (keep.length !== Object.keys(rec).length) changed = true
    if (keep.length) records[label] = Object.fromEntries(keep)
  }
  const ready = state.messages.ready.filter((l) => tupleByLabel(state, l) !== null)
  if (ready.length !== state.messages.ready.length) changed = true
  return changed ? { ...state, messages: { ...state.messages, records, ready } } : state as HolderState
}

/** When retainMessages lets an entry go by time (the timer contract). */
function messageDeadlines (state: Readonly<HolderState>): Millis[] {
  const out: Millis[] = []
  for (const rec of Object.values(state.messages.records)) {
    let first = Infinity
    for (const e of Object.values(rec)) first = Math.min(first, e.sentAt + MESSAGE_LIFETIME_MS + 1)
    if (first !== Infinity) out.push(first)
  }
  return out
}

// ── the block act (Section 6.1) ────────────────────────────────────────

const blockDef: CommandDef<BlockInput, null> = {
  human: true,
  apply (state, _p, input) {
    if (typeof input?.contactId !== 'string' || typeof input.blocked !== 'boolean') throw new TypeError('message.block needs {contactId, blocked}')
    const c = findContact(state, input.contactId)
    if (!c) return no('unknown-contact')
    // every relationship of the entry (6020); unblocking deletes nothing
    // else and surfaces nothing (6510)
    const blocked = withBlocked(state.messages.blocked, c.relIds, input.blocked)
    return {
      state: { ...state, messages: { ...state.messages, blocked } },
      events: [{ type: 'contact.blocked', contactId: c.id, blocked: input.blocked }],
    }
  },
}

/** The message module createHolder registers. */
export function messageModule (): HolderModule {
  return Object.freeze({
    name: 'message',
    commands: Object.freeze({ [MESSAGE_COMMANDS.send]: sendDef, [MESSAGE_COMMANDS.block]: blockDef, [MESSAGE_COMMANDS.take]: takeDef }),
    tasks: Object.freeze({ [MESSAGE_TYPE]: messageTask }),
    accepted: markReady,
    retain: retainMessages,
    deadlines: messageDeadlines,
  })
}
