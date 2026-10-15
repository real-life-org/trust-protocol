// introduction/holder — the Introduction Act on the holder (lib Stage 2,
// PR 7a; Trust Layer 0.31 §8 on Delivery 0.81 §4.4). The pure forms are
// the root module's (introduction.ts). Trust 0.31 §8 relays the act
// through the mediator; no rendezvous drop is needed or built.
//
// The three roles, each its own lifecycle (8320), in
// state.encounter.introductions under `<role>:<act>`:
//   requester  holds an offer (below), decides on an `introduction`
//              prompt, sends introduction-request/0.1 on its pinned tuple
//              toward the mediator (8270), with a fresh pair label and card;
//              sent → acked (the ack) → completed (an accepted reply, 8.2);
//              failed on the ack timeout (8690) or the reply timeout (8340)
//   mediator   received (checks 1–3 of 8410–8430, the ack duty bound),
//              forwarded (the target resolved, the byte-identical payload
//              on its tuple, 8440), completed once the ack is produced, the
//              reply forwarded and both vouchers sent (8360)
//   target     received (a forward verified, 8050) → an `introduction`
//              prompt; consented (its reply sent) or refused (local, silent)
// The new relationship: the requester opens its fresh tuple toward the
// target's card on an accepted reply, the target toward the requester's
// card at consent (Trust openTuple, provenance `introduced` via the
// mediator's contact, 8790); the continuity probe follows on it. A
// verified voucher marks the relationship's memory `vouchedBy`.
//
// What it registers (introductionModule):
//   human acts  introduction.introduce  the mediator's act (below)
//   decision    introduction: on an offer, accept sends the request; on a
//               forward, accept consents (the reply), decline refuses
//   tasks       introduction-request/0.1, -forward/0.1, -reply/0.1
//               (signature class: signed acks), -ack/0.1, -voucher/0.1 (DV
//               class: MAC acks), registry-declaration/0.1 (proof
//               required) and x-introduction-offer/0.1 (this library's
//               form, proof required); every one on the tuple binding
//   duty        intro-ack/1: the mediator's one ack at t_received + ack-delay
//   retain      time-driven transitions (8140: the first whole second after
//               the bound) and the discard at the absolute lifetime (8310)
//   keepKeys    the own rkids of every pinned tuple of a held act: a
//               chaining mid-act deactivates it, tick keeps its key (8270,
//               8290)
//
// Choices this file makes where spec and note leave them open:
//   - who starts: §8 has the requester mint the act and name the target by
//     the mediator's designator (8.3), but says nothing of how the
//     requester learns that designator. This library has the mediator's
//     act `introduce(requester, target, {label?})` (the human who knows
//     both) send the requester an
//     experimental, signed x-introduction-offer/0.1 with the designator and
//     at most a label the mediator's human typed in that act — never a
//     name read from the target's profile (audience: the mediator alone,
//     6b) or card, and no provenance of the mediator↔target relationship —
//     with the mediator's registry declaration of ack-delay (Delivery §4.4:
//     a requester never sends without holding it). The requester's human
//     accepts on an `introduction` prompt, which sends the request. Gaps
//     for Trust 0.32: the designator's way to the requester (§8.3), and
//     the residue that the offer, signed, is transferable: the requester
//     can show a third party that the mediator offered it this designator
//     and label
//   - the designator: 32 fresh bytes, u-base64url, minted once per target
//     contact and kept (stable per (mediator, target), 8610); the target
//     verifies "designates itself" by the channel the forward arrives on,
//     the mediator's pinned tuple toward it — it cannot read the handle
//   - ack-delay: a library constant the mediator declares, PT30S (in
//     [PT1S, PT1H]), revision 1, identical to every counterpart
//   - acks of the documents: the request, forward and reply carry
//     transferable signatures and earn signed delivery-acks (Delivery 4.4's
//     class rule); the ack and voucher artifacts are DV and earn MAC acks
//   - the forward opens a fresh thread toward the target; the reply comes
//     on it and is forwarded on the request's thread; the ack and the
//     requester's voucher travel on the request's thread, the target's on
//     the forward's
//   - an artifact outside its window is refused at stage 8 from its own
//     bytes (8110); a refusal by a role's lifecycle (a late reply of a
//     failed act, 8350; a reply after the cutoff, 8180) commits only the
//     document's acknowledgement: the act is unchanged
//   - the requester's profile in the request is its display name (the own
//     profile's, at most 64 characters, 8450); the cards carry no name
//   - the name of an introduced contact: at the target the request's
//     displayName, at the requester the offer's label; kept in the
//     relationship's memory as `introducedName`, which the views read until
//     a profile arrives (self-declared, Encounter 6120)
import { iso, jcs } from '../core.js'
import type { Json, JsonObject } from '../core.js'
import { diSignWith, diVerify, digestBytes, digestDoc, xRawOfMk } from '../crypto.js'
import { seal } from '../delivery.js'
import { cardBody } from '../encounter.js'
import {
  ACT_EXPIRY, ACT_SKEW, DECLARATION_TYPE, INTRODUCTION_TYPES, MAC_ACK_INFO, MAC_VOUCHER_INFO, MEDIATOR_ROLE, actIdOf, designatorOf, designatorOk,
  introDigest, actFiresAt, introCardShapeOk, introMacKey, introSchemaOk, introMacArtifact, introMacOk, mediatorConstants, replyBound, replyCutoffHolds,
  requestCutoffHolds, requestFormOk, signIntroArtifact, actWindowHolds,
} from '../introduction.js'
import type { AckBody, Artifact, ReplyBody, RequestBody, VoucherBody } from '../introduction.js'
import { b64uOf } from '../core.js'
import { tupleByRkid } from '../receive.js'
import type { TaskRefusal } from '../receive.js'
import type { Applied, CommandDef, DecisionDef, DutyHandler, EventDraft, HolderModule, OutboundDraft, PrepareCtx, Refusal, TaskHandler } from '../engine.js'
import type { Recipient } from '../ports.js'
import type { HolderState, IntroAct, IntroAckDuty, IntroOffer, Millis, Prompt } from '../state.js'
import { openTuple } from '../trust/continuity.js'
import { activeTuple, entryOf, findContact, liveRel, tupleByLabel } from '../trust/state.js'
import { idsOf } from '../encounter/ceremony.js'
import { withPairNonce } from '../identity-state.js'
import { tsec } from '../core.js'

const TT = 'https://real-life.org/trust-tasks/'
export const OFFER_TYPE = TT + 'x-introduction-offer/0.1'
export { DECLARATION_TYPE, INTRODUCTION_TYPES }

/** The mediator's declared ack-delay (Delivery §4.4, Trust 8.4). */
export const ACK_DELAY = 'PT30S'
export const ACK_DELAY_MS = 30_000

export const INTRODUCTION_COMMANDS = Object.freeze({ introduce: 'introduction.introduce' })
export interface IntroduceInput { requesterId: string, targetId: string, label?: string }

const refuse = (reason: TaskRefusal['reason'], ref?: string): TaskRefusal => ({ ok: false, reason, ...(ref ? { ref } : {}) })
const no = (code: Refusal['code'], ref?: string): Refusal => ({ ok: false, code, ...(ref ? { ref } : {}) })
const isRefusal = (x: unknown): x is Refusal | TaskRefusal => (x as Refusal)?.ok === false
type Doc = Record<string, any>
const keyOf = (role: IntroAct['role'], act: string): string => `${role}:${act}`
const offerPromptId = (digest: string): string => 'intro-offer:' + digest
const consentPromptId = (act: string): string => 'intro:' + act

interface Sealed { digest: string, envelope: OutboundDraft['envelope'], threadId: string, type: string, recipient: Recipient }
const draft = (s: Sealed): OutboundDraft => ({ digest: s.digest, envelope: s.envelope, type: s.type, threadId: s.threadId, recipient: s.recipient })

/** A document from an own pair label's anchor on a tuple, sealed to its counterpart. */
async function onTuple (ctx: PrepareCtx, label: string, type: string, payload: unknown, threadId: string, sign = false): Promise<Sealed> {
  const at = tupleByLabel(ctx.snapshot, label)
  if (!at) throw new Error(`introduction: no tuple ${label}`)
  const own = await ctx.keys.anchorOf(label)
  const issuedAt = iso(ctx.when)
  let doc: Doc = { id: ctx.entropy.id('doc.id'), type, issuer: own.anchor, recipient: at.tuple.counterpartAnchor, threadId, issuedAt, payload }
  if (sign) doc = await diSignWith(own.anchor, (b) => ctx.keys.sign(label, b), doc, issuedAt, ctx.crypto.subtle)
  const S = ctx.crypto.subtle
  return {
    digest: await digestDoc(doc, S),
    envelope: await seal(doc as Json, at.tuple.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S),
    threadId, type,
    recipient: { contactId: entryOf(ctx.snapshot, at.rel)?.id ?? at.rel.contactId, rkid: at.tuple.rkid, keyAgreement: at.tuple.counterpartKeyAgreement },
  }
}

/** The MAC key of the pinned tuple `label` (8630, 8730). */
async function pinKey (ctx: PrepareCtx, label: string, info: string): Promise<Uint8Array | null> {
  const at = tupleByLabel(ctx.snapshot, label)
  const raw = at ? xRawOfMk(at.tuple.counterpartKeyAgreement) : null
  if (!at || !raw) return null
  const a = await ctx.keys.agree(at.tuple.rkid, raw, ctx.release)
  return a.status === 'available' ? introMacKey(a.shared, info, ctx.crypto.subtle) : null
}

/** The live active tuple toward a contact (8020: a pair relationship). */
function channelTo (state: Readonly<HolderState>, contactId: string) {
  const c = findContact(state, contactId)
  if (!c) return null
  const ids = new Set([c.id, ...c.aliases])
  for (const id of c.relIds) {
    const r = state.relationships[id]
    const t = r && liveRel(r) ? activeTuple(r) : undefined
    if (t && !t.deactivated && ids.has(t.entryId)) return { contact: c, rel: r, tuple: t }
  }
  return null
}

/** The arrival tuple of a document, with the entry it feeds. */
function arrival (state: Readonly<HolderState>, rkid: string) {
  const at = tupleByRkid(state, rkid)
  return at ? { label: at.tuple.ownPairLabel, contactId: entryOf(state, at.rel)?.id ?? at.rel.contactId, tuple: at.tuple, rel: at.rel } : null
}

const withAct = (state: HolderState, a: IntroAct): HolderState =>
  ({ ...state, encounter: { ...state.encounter, introductions: { ...state.encounter.introductions, [a.key]: a } } })

const held = (state: Readonly<HolderState>, role: IntroAct['role'], act: string): IntroAct | undefined => state.encounter.introductions[keyOf(role, act)]

/** The requester's status at `when` (8340, 8690, 8140): a timeout fires at
 *  the first whole second after its bound, whether or not tick ran. */
function requesterStatus (a: Readonly<IntroAct>, when: Millis): IntroAct['status'] {
  if (a.status === 'sent' && when >= actFiresAt(a.at + a.ackDelayMs + ACT_SKEW)) return 'failed'
  if (a.status === 'acked' && when >= actFiresAt(a.at + ACT_EXPIRY)) return 'failed'
  return a.status
}

const lifetimeOver = (a: Readonly<IntroAct>, when: Millis): boolean => when >= actFiresAt(a.issuedAt + ACT_EXPIRY + ACT_SKEW)

/** The mediator's completion (8360): ack produced, reply forwarded, vouchers sent. */
const completedIfDone = (a: IntroAct): IntroAct =>
  a.role === 'mediator' && a.ack !== null && a.replyForwarded && a.vouchersSent ? { ...a, status: 'completed' } : a

/** The own profile name for the request's displayName (≤ 64, 8450). */
const displayNameOf = (state: Readonly<HolderState>): string | undefined => {
  const n = (state.profile.body as { name?: unknown } | null)?.name
  return typeof n === 'string' && n.length ? [...n].slice(0, 64).join('') : undefined
}

/** A fresh pair label and its displayed card, no challenge, no name (the
 *  act's fresh anchor, 8010; an rltp-card/0.25 under Encounter's DI rules). */
async function freshCard (ctx: PrepareCtx): Promise<{ label: string, nonce: string, rkid: string, anchor: string, card: Doc }> {
  const n = ctx.entropy.bytes('founding.nonce', 32)
  const label = 'pair/' + await digestBytes(n, ctx.crypto.subtle)
  const me = await ctx.keys.anchorOf(label)
  const at = iso(ctx.when)
  const card = await diSignWith(me.anchor, (b) => ctx.keys.sign(label, b), cardBody(me) as unknown as Record<string, Json>, at, ctx.crypto.subtle)
  return { label, nonce: b64uOf(n), rkid: me.keyAgreement, anchor: me.anchor, card }
}

/** The fresh relationship of an act toward the counterpart's card, introduced via the mediator (8790). */
function openIntroduced (state: Readonly<HolderState>, label: string, nonce: string | undefined, rkid: string, card: Doc, via: string, name: string | undefined, when: Millis): Applied {
  const ids = idsOf(label)
  const opened = openTuple(state, {
    relId: ids.relId, contactId: ids.contactId, ownPairLabel: label, counterpartAnchor: card.anchor, counterpartKeyAgreement: card.keyAgreement,
    provenance: { kind: 'introduced', via }, ...(nonce !== undefined ? { nonce } : {}),
  }, rkid, when)
  if (name === undefined) return opened
  const rel = opened.state.relationships[ids.relId]
  return { ...opened, state: { ...opened.state, relationships: { ...opened.state.relationships, [ids.relId]: { ...rel, memory: { ...rel.memory, introducedName: name } } } } }
}

// ── the mediator's act ─────────────────────────────────────────────────

type IntroducePrep = Refusal | { designator: string, minted: boolean, offer: Sealed, declaration: Sealed }

const introduceDef: CommandDef<IntroduceInput, IntroducePrep> = {
  human: true,
  async prepare (ctx, input) {
    const s = ctx.snapshot
    const r = channelTo(s, input?.requesterId), t = channelTo(s, input?.targetId)
    if (!r || !t) return no('no-own-channel', 'RLTP-TRU-8020')
    if (r.contact.id === t.contact.id) return no('unknown-contact')
    const held = Object.entries(s.encounter.designators).find(([, c]) => c === t.contact.id)?.[0]
    const designator = held ?? designatorOf(ctx.entropy.bytes('intro.target', 32))
    const label = input.label
    if (label !== undefined && (typeof label !== 'string' || !label.length || [...label].length > 64)) throw new TypeError('introduction.introduce: label is 1 to 64 characters')
    const declaration = await onTuple(ctx, r.tuple.ownPairLabel, DECLARATION_TYPE,
      { declaration: { role: MEDIATOR_ROLE, revision: '1', constants: { 'ack-delay': ACK_DELAY } } }, ctx.entropy.id('thread.id'), true)
    const offer = await onTuple(ctx, r.tuple.ownPairLabel, OFFER_TYPE,
      { target: designator, ...(label !== undefined ? { label } : {}) }, ctx.entropy.id('thread.id'), true)
    return { designator, minted: held === undefined, offer, declaration }
  },
  apply (state, prepared, input) {
    const p = prepared.value
    if (isRefusal(p)) return p
    const designators = p.minted ? { ...state.encounter.designators, [p.designator]: findContact(state, input.targetId)!.id } : state.encounter.designators
    return { state: { ...state, encounter: { ...state.encounter, designators } }, outbound: [draft(p.declaration), draft(p.offer)] }
  },
}

// ── the registry declaration (Delivery §4.4) ───────────────────────────

const declarationTask: TaskHandler<Doc, null> = {
  proof: 'required',
  decode: (p) => (introSchemaOk('payload-registry-declaration.schema.json', p) ? p as Doc : refuse('malformed')),
  async prepare (ctx, doc) {
    if (!(await diVerify(doc, doc.issuer, ctx.crypto.subtle))) return refuse('validation-failed')
    const d = doc.payload.declaration
    // the registering specification closes names and domains: only the mediator role is known here
    if (d.role !== MEDIATOR_ROLE || mediatorConstants(d.constants) === null) return refuse('validation-failed')
    return null
  },
  // the generic revision rule: higher wins, equal and identical is
  // idempotent, equal and different or lower is refused
  apply (state, _p, doc, arr) {
    const d = doc.payload.declaration
    const k = `${doc.issuer} ${d.role}`
    const h = state.encounter.declarations[k]
    if (h) {
      const cmp = BigInt(d.revision) - BigInt(h.revision)
      if (cmp < 0n) return refuse('validation-failed')
      if (cmp === 0n) return jcs(h.constants) === jcs(d.constants) ? { state: state as HolderState } : refuse('validation-failed')
    }
    return { state: { ...state, encounter: { ...state.encounter, declarations: { ...state.encounter.declarations, [k]: { issuer: doc.issuer, role: d.role, revision: d.revision, constants: d.constants, at: arr.when } } } } }
  },
}

// ── the offer at the requester (this library's form) ───────────────────

const offerTask: TaskHandler<Doc, null> = {
  proof: 'required',
  decode (p) {
    const x = p as Record<string, unknown>
    if (x === null || typeof x !== 'object' || !designatorOk(x.target) ||
      (x.label !== undefined && (typeof x.label !== 'string' || !x.label.length || [...x.label].length > 64)) || Object.keys(x).some((k) => !['target', 'label'].includes(k))) return refuse('malformed')
    return x as Doc
  },
  async prepare (ctx, doc) { return (await diVerify(doc, doc.issuer, ctx.crypto.subtle)) ? null : refuse('validation-failed') },
  apply (state, _p, doc, arr) {
    const a = arrival(state, arr.rkid)!
    const o: IntroOffer = {
      id: offerPromptId(arr.digest), mediatorContactId: a.contactId, pin: a.label, target: doc.payload.target,
      ...(doc.payload.label !== undefined ? { label: doc.payload.label } : {}), at: arr.when,
    }
    const prompt: Prompt = { id: o.id, kind: 'introduction', contactId: a.contactId, openedAt: arr.when, expiresAt: arr.when + ACT_EXPIRY }
    return {
      state: { ...state, encounter: { ...state.encounter, offers: { ...state.encounter.offers, [o.id]: o } }, prompts: { ...state.prompts, [prompt.id]: prompt } },
      events: [{ type: 'prompt.opened', promptId: prompt.id, kind: 'introduction' }],
    }
  },
}

// ── the request: the requester's decision on an offer ──────────────────

interface RequestPrep { act: string, fresh: Awaited<ReturnType<typeof freshCard>>, request: Artifact<RequestBody>, doc: Sealed, ackDelayMs: number }

async function prepareRequest (ctx: PrepareCtx, o: Readonly<IntroOffer>): Promise<RequestPrep | Refusal> {
  const pin = tupleByLabel(ctx.snapshot, o.pin)
  if (!pin || pin.tuple.deactivated) return no('no-own-channel', 'RLTP-TRU-8270')
  // Delivery §4.4: never a request to a mediator whose declaration is not held
  const dec = ctx.snapshot.encounter.declarations[`${pin.tuple.counterpartAnchor} ${MEDIATOR_ROLE}`]
  const c = dec ? mediatorConstants(dec.constants) : null
  if (!c) return no('no-declaration')
  const fresh = await freshCard(ctx)
  const act = actIdOf(ctx.entropy.bytes('intro.act', 32))
  const name = displayNameOf(ctx.snapshot)
  const body: RequestBody = {
    type: 'introduction-request@1', act, issuedAt: iso(ctx.when), target: o.target,
    cardDigest: await introDigest(fresh.card, ctx.crypto.subtle), profile: name !== undefined ? { displayName: name } : {},
  }
  const request = await signIntroArtifact(body, (b) => ctx.keys.sign(fresh.label, b))
  const doc = await onTuple(ctx, o.pin, INTRODUCTION_TYPES.request, { introduction: request, card: fresh.card }, ctx.entropy.id('thread.id'))
  return { act, fresh, request, doc, ackDelayMs: c.ackDelayMs }
}

function applyRequest (state: Readonly<HolderState>, o: Readonly<IntroOffer>, p: RequestPrep, when: Millis): Applied | Refusal {
  if (held(state, 'requester', p.act)) throw new Error('introduction: the act id is not fresh (8080)')
  if (state.register.labels.includes(p.fresh.label)) throw new Error('introduction: the pair label is not fresh')
  const a: IntroAct = {
    key: keyOf('requester', p.act), act: p.act, role: 'requester', status: 'sent', issuedAt: tsec(when), request: p.request as unknown as JsonObject,
    requestCard: p.fresh.card as JsonObject, reply: null, replyCard: null, pins: { mediator: o.pin }, threads: { request: p.doc.threadId },
    at: when, ackDelayMs: p.ackDelayMs, ownLabel: p.fresh.label, ack: null, replyForwarded: false, vouchersSent: false,
    pendingVoucher: null, voucher: null, vouched: false, promptId: null, ...(o.label !== undefined ? { peerName: o.label } : {}),
  }
  const offers = { ...state.encounter.offers }
  delete offers[o.id]
  const next: HolderState = {
    ...state,
    // the act's fresh label in the register before its card is shown (Identity 6.1)
    register: withPairNonce(state.register, p.fresh.label, p.fresh.nonce),
    addresses: { ...state.addresses, keys: { ...state.addresses.keys, [p.fresh.rkid]: { label: p.fresh.label, lastShown: when } } },
    encounter: { ...state.encounter, offers },
  }
  return { state: withAct(next, a), outbound: [draft(p.doc)] }
}

// ── the mediator: the request (8410–8440) ──────────────────────────────

interface RequestPayload { introduction: Artifact<RequestBody>, card: Doc }
type MediatorPrep = { dup: 'same' | 'none', forward: Sealed | null, target: string | null, ack: Sealed | null }

const requestTask: TaskHandler<RequestPayload, MediatorPrep> = {
  proof: 'absent',
  decode: (p) => (introSchemaOk('visibility-payload-introduction-request.schema.json', p) ? p as RequestPayload : refuse('malformed')),
  async prepare (ctx, doc, arr) {
    const s = ctx.snapshot
    const a = arrival(s, arr.rkid)!
    const body = doc.payload.introduction.body
    // step 1: an active channel (the pin set at arrival)
    if (!liveRel(a.rel) || a.tuple.deactivated || a.rel.activeHead !== a.label) return refuse('validation-failed', 'RLTP-TRU-8410')
    // step 2: form — schema (decode), digest, signature, the window, the ack cutoff
    if (!introCardShapeOk(doc.payload.card) || !(await diVerify(doc.payload.card, doc.payload.card.anchor, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-8420')
    if (!(await requestFormOk(doc.payload, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-8420')
    if (!actWindowHolds(body.issuedAt, ctx.when) || !requestCutoffHolds(body.issuedAt, ctx.when, ACK_DELAY_MS)) return refuse('validation-failed', 'RLTP-TRU-8160')
    const h = held(s, 'mediator', body.act)
    if (h) {
      if (jcs((h.request as Doc).body) !== jcs(doc.payload.introduction.body)) return refuse('validation-failed', 'RLTP-TRU-8240')
      // a byte-identical repeat: the one ack value, once produced (8220, 8230)
      const ack = h.ack ? await onTuple(ctx, a.label, INTRODUCTION_TYPES.ack, { introduction: h.ack }, h.threads.request) : null
      return { dup: 'same', forward: null, target: null, ack }
    }
    // step 4: resolution, for forwarding only and silently (8440)
    const targetId = s.encounter.designators[body.target]
    const t = targetId !== undefined ? channelTo(s, targetId) : null
    const forward = t && t.tuple.ownPairLabel !== a.label
      ? await onTuple(ctx, t.tuple.ownPairLabel, INTRODUCTION_TYPES.forward, doc.payload, ctx.entropy.id('thread.id'))
      : null
    return { dup: 'none', forward, target: forward ? t!.tuple.ownPairLabel : null, ack: null }
  },
  // step 3: received, the ack duty bound before and independent of resolution (8430)
  apply (state, prepared, doc, arr) {
    const p = prepared.value
    if (p.dup === 'same') return { state: state as HolderState, outbound: p.ack ? [draft(p.ack)] : [] }
    const a = arrival(state, arr.rkid)!
    const body = doc.payload.introduction.body
    const act: IntroAct = {
      key: keyOf('mediator', body.act), act: body.act, role: 'mediator', status: p.forward ? 'forwarded' : 'received',
      issuedAt: Date.parse(body.issuedAt), request: doc.payload.introduction as unknown as JsonObject, requestCard: doc.payload.card as JsonObject,
      reply: null, replyCard: null, pins: { requester: a.label, ...(p.target ? { target: p.target } : {}) },
      threads: { request: doc.threadId, ...(p.forward ? { forward: p.forward.threadId } : {}) }, at: arr.when, ackDelayMs: ACK_DELAY_MS,
      ownLabel: null, ack: null, replyForwarded: false, vouchersSent: false, pendingVoucher: null, voucher: null, vouched: false, promptId: null,
    }
    const duty: IntroAckDuty = { kind: 'intro-ack', v: 1, id: 'intro-ack:' + body.act, dueAt: arr.when + ACK_DELAY_MS, act: body.act }
    return { state: withAct(state as HolderState, act), duties: [duty], outbound: p.forward ? [draft(p.forward)] : [] }
  },
}

/** The mediator's one ack, at t_received + ack-delay (8640), identical for
 *  every target (8650); none after the absolute lifetime (8280). */
const ackDuty: DutyHandler<{ sealed: Sealed, ack: Json } | null> = {
  v: 1,
  async prepare (ctx, duty) {
    const a = held(ctx.snapshot, 'mediator', (duty as IntroAckDuty).act)
    if (!a || a.ack || lifetimeOver(a, ctx.when) || !a.pins.requester) return null
    const key = await pinKey(ctx, a.pins.requester, MAC_ACK_INFO)
    if (!key) return null
    const ack = await introMacArtifact<AckBody>({ type: 'introduction-ack@1', act: a.act }, key, ctx.crypto.subtle)
    return { sealed: await onTuple(ctx, a.pins.requester, INTRODUCTION_TYPES.ack, { introduction: ack }, a.threads.request), ack: ack as unknown as JsonObject }
  },
  apply (state, duty, ctx, when) {
    const a = held(state, 'mediator', (duty as IntroAckDuty).act)
    const p = ctx.prepared.value
    // past the lifetime, or the pinned key gone: the duty ends without production (8280)
    if (!a || a.ack || lifetimeOver(a, when) || p === null) return { state: state as HolderState }
    // the ack value as produced, retained for re-delivery (8200, 8230)
    return { state: withAct(state as HolderState, completedIfDone({ ...a, ack: p.ack as JsonObject })), outbound: [draft(p.sealed)] }
  },
}

// ── the target: the forward (8050) and its consent ─────────────────────

const forwardTask: TaskHandler<RequestPayload, { known: boolean }> = {
  proof: 'absent',
  decode: (p) => (introSchemaOk('visibility-payload-introduction-forward.schema.json', p) ? p as RequestPayload : refuse('malformed')),
  async prepare (ctx, doc) {
    const body = doc.payload.introduction.body
    if (!actWindowHolds(body.issuedAt, ctx.when)) return refuse('validation-failed', 'RLTP-TRU-8110')
    const h = held(ctx.snapshot, 'target', body.act)
    if (h) return jcs((h.request as Doc).body) === jcs(doc.payload.introduction.body) ? { known: true } : refuse('validation-failed', 'RLTP-TRU-8260')
    // the request signature under the card's anchor, cardDigest, the card (8050)
    if (!(await requestFormOk(doc.payload, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-8050')
    if (!introCardShapeOk(doc.payload.card) || !(await diVerify(doc.payload.card, doc.payload.card.anchor, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-8050')
    return { known: false }
  },
  // received: the pin at the forward's arrival (8270); the human decides
  // on its own device (8810); "designates itself" is the channel it came on
  apply (state, prepared, doc, arr) {
    if (prepared.value.known) return { state: state as HolderState }
    const a = arrival(state, arr.rkid)!
    const body = doc.payload.introduction.body
    const promptId = consentPromptId(body.act)
    const act: IntroAct = {
      key: keyOf('target', body.act), act: body.act, role: 'target', status: 'received', issuedAt: Date.parse(body.issuedAt),
      request: doc.payload.introduction as unknown as JsonObject, requestCard: doc.payload.card as JsonObject, reply: null, replyCard: null,
      pins: { mediator: a.label }, threads: { request: '', forward: doc.threadId }, at: arr.when, ackDelayMs: 0, ownLabel: null, ack: null,
      replyForwarded: false, vouchersSent: false, pendingVoucher: null, voucher: null, vouched: false, promptId,
    }
    const prompt: Prompt = { id: promptId, kind: 'introduction', contactId: a.contactId, openedAt: arr.when, expiresAt: actFiresAt(act.issuedAt + ACT_EXPIRY + ACT_SKEW) }
    return {
      state: { ...withAct(state as HolderState, act), prompts: { ...state.prompts, [promptId]: prompt } },
      events: [{ type: 'prompt.opened', promptId, kind: 'introduction' }],
    }
  },
}

interface ReplyPrep { fresh: Awaited<ReturnType<typeof freshCard>>, reply: Artifact<ReplyBody>, doc: Sealed }

async function prepareReply (ctx: PrepareCtx, a: Readonly<IntroAct>): Promise<ReplyPrep | Refusal> {
  if (!a.pins.mediator || !tupleByLabel(ctx.snapshot, a.pins.mediator)) return no('no-own-channel', 'RLTP-TRU-8270')
  const fresh = await freshCard(ctx)
  const S = ctx.crypto.subtle
  const request = a.request as unknown as Artifact<RequestBody>
  const body: ReplyBody = {
    type: 'introduction-reply@1', act: a.act, requestDigest: await introDigest(request.body, S),
    requesterPair: (a.requestCard as Doc).anchor, cardDigest: await introDigest(fresh.card, S),
  }
  const reply = await signIntroArtifact(body, (b) => ctx.keys.sign(fresh.label, b))
  const doc = await onTuple(ctx, a.pins.mediator, INTRODUCTION_TYPES.reply, { introduction: reply, card: fresh.card }, a.threads.forward!)
  return { fresh, reply, doc }
}

/** The target consents: its reply out, its fresh tuple toward the requester's card (8380). */
function applyConsent (state: Readonly<HolderState>, a: Readonly<IntroAct>, p: ReplyPrep, when: Millis): Applied | Refusal {
  if (a.status !== 'received') return no('unknown-act')
  if (lifetimeOver(a, when)) return no('prompt-expired', 'RLTP-TRU-8280')
  const via = arrivalContact(state, a.pins.mediator!)
  const name = ((a.request as Doc).body.profile as { displayName?: string }).displayName
  const opened = openIntroduced(state, p.fresh.label, p.fresh.nonce, p.fresh.rkid, a.requestCard as Doc, via, name, when)
  const next: IntroAct = { ...a, status: 'consented', reply: p.reply as unknown as JsonObject, replyCard: p.fresh.card as JsonObject, ownLabel: p.fresh.label }
  return { state: withAct(opened.state, next), outbound: [draft(p.doc)], events: opened.events, duties: opened.duties }
}

const arrivalContact = (state: Readonly<HolderState>, label: string): string => {
  const at = tupleByLabel(state, label)
  return at ? (entryOf(state, at.rel)?.id ?? at.rel.contactId) : ''
}

/** introduction: on an offer, accept sends the request; on a forward,
 *  accept consents and decline refuses, locally and silently (8380). */
const introductionDecision: DecisionDef<RequestPrep | ReplyPrep | Refusal | null> = {
  async prepare (ctx, prompt, choice) {
    if (choice !== 'accept') return null
    const o = ctx.snapshot.encounter.offers[prompt.id]
    if (o) return prepareRequest(ctx, o)
    const a = Object.values(ctx.snapshot.encounter.introductions).find((x) => x.promptId === prompt.id && x.role === 'target')
    return a ? prepareReply(ctx, a) : no('unknown-act')
  },
  apply (state, prompt, choice, when, prepared) {
    const o = state.encounter.offers[prompt.id]
    const a = Object.values(state.encounter.introductions).find((x) => x.promptId === prompt.id && x.role === 'target')
    if (choice === 'decline') {
      if (o) {
        const offers = { ...state.encounter.offers }
        delete offers[o.id]
        return { state: { ...state, encounter: { ...state.encounter, offers } } }
      }
      return a ? { state: withAct(state as HolderState, { ...a, status: 'refused' }) } : { state: state as HolderState }
    }
    const p = prepared.value
    if (p === null || isRefusal(p)) return p ?? no('unknown-act')
    if (o) return applyRequest(state, o, p as RequestPrep, when)
    return a ? applyConsent(state, a, p as ReplyPrep, when) : no('unknown-act')
  },
}

// ── the reply at the mediator (8480–8540) and at the requester (8550–8600) ─

interface ReplyPayload { introduction: Artifact<ReplyBody>, card: Doc }
type MediatorReplyPrep = { repeat: boolean, toRequester: Sealed | null, vouchers: Sealed[], orphaned?: true }
type RequesterReplyPrep = { ignore: boolean }

const replyChecks = async (ctx: PrepareCtx, a: Readonly<IntroAct>, payload: ReplyPayload): Promise<string | null> => {
  const r = payload.introduction.body
  if (!(await replyBound(payload, ctx.crypto.subtle))) return a.role === 'mediator' ? 'RLTP-TRU-8500' : 'RLTP-TRU-8560'
  if (r.requestDigest !== await introDigest((a.request as Doc).body, ctx.crypto.subtle)) return a.role === 'mediator' ? 'RLTP-TRU-8510' : 'RLTP-TRU-8570'
  if (r.requesterPair !== (a.requestCard as Doc).anchor) return a.role === 'mediator' ? 'RLTP-TRU-8520' : 'RLTP-TRU-8580'
  if (!introCardShapeOk(payload.card) || !(await diVerify(payload.card, payload.card.anchor, ctx.crypto.subtle))) return a.role === 'mediator' ? 'RLTP-TRU-8530' : 'RLTP-TRU-8590'
  return null
}

const replyTask: TaskHandler<ReplyPayload, MediatorReplyPrep | RequesterReplyPrep> = {
  proof: 'absent',
  decode: (p) => (introSchemaOk('visibility-payload-introduction-reply.schema.json', p) ? p as ReplyPayload : refuse('malformed')),
  async prepare (ctx, doc, arr) {
    const s = ctx.snapshot
    const r = doc.payload.introduction.body
    const at = arrival(s, arr.rkid)!
    const m = held(s, 'mediator', r.act)
    if (m && m.pins.target === at.label) {
      // step 2: on the pinned mediator↔target tuple; step 3: forwarded, window and cutoff
      if (m.status !== 'forwarded' && m.status !== 'completed') return refuse('validation-failed', 'RLTP-TRU-8490')
      // a held reply first: a differing one is rejected at any time (8250)
      if (m.reply) {
        if (jcs((m.reply as Doc).body) !== jcs(doc.payload.introduction.body)) return refuse('validation-failed', 'RLTP-TRU-8250')
        return { repeat: true, toRequester: null, vouchers: [] }
      }
      const issuedAt = (m.request as Doc).body.issuedAt as string
      if (!actWindowHolds(issuedAt, ctx.when) || !replyCutoffHolds(issuedAt, ctx.when)) return { repeat: true, toRequester: null, vouchers: [] }   // 8180: dropped silently
      const bad = await replyChecks(ctx, m, doc.payload)
      if (bad) return refuse('validation-failed', bad)
      // the requester's relationship departed while the act ran: the reply is
      // taken (an authentic document on the pinned target tuple), the relay
      // ends as failed; nothing goes to a departed relationship
      if (!tupleByLabel(s, m.pins.requester!)) return { repeat: false, toRequester: null, vouchers: [], orphaned: true }
      // forward unchanged (8060) and both vouchers (8740)
      const toRequester = await onTuple(ctx, m.pins.requester!, INTRODUCTION_TYPES.reply, doc.payload, m.threads.request)
      const vouchers: Sealed[] = []
      const vb: VoucherBody = { type: 'introduction-voucher@1', act: r.act, requesterPair: (m.requestCard as Doc).anchor, targetPair: doc.payload.card.anchor }
      for (const [side, thread] of [[m.pins.requester!, m.threads.request], [m.pins.target!, m.threads.forward!]] as const) {
        const key = await pinKey(ctx, side, MAC_VOUCHER_INFO)
        if (!key) return refuse('validation-failed')
        vouchers.push(await onTuple(ctx, side, INTRODUCTION_TYPES.voucher, { voucher: await introMacArtifact(vb, key, ctx.crypto.subtle) }, thread))
      }
      return { repeat: false, toRequester, vouchers }
    }
    const q = held(s, 'requester', r.act)
    if (!q || q.pins.mediator !== at.label) return refuse('validation-failed', 'RLTP-TRU-8550')
    if (!actWindowHolds((q.request as Doc).body.issuedAt, ctx.when)) return refuse('validation-failed', 'RLTP-TRU-8550')
    if (q.reply) return jcs((q.reply as Doc).body) === jcs(doc.payload.introduction.body) ? { ignore: true } : refuse('validation-failed', 'RLTP-TRU-8260')
    // a late reply of a failed act is ignored (8350)
    if (requesterStatus(q, ctx.when) === 'failed') return { ignore: true }
    const bad = await replyChecks(ctx, q, doc.payload)
    return bad ? refuse('validation-failed', bad) : { ignore: false }
  },
  apply (state, prepared, doc, arr) {
    const r = doc.payload.introduction.body
    const p = prepared.value
    if ('vouchers' in p) {
      const m = held(state, 'mediator', r.act)!
      if (p.repeat) return { state: state as HolderState }
      if (p.orphaned) return { state: withAct(state as HolderState, { ...m, status: 'failed', reply: doc.payload.introduction as unknown as JsonObject, replyCard: doc.payload.card as JsonObject }) }
      const next = completedIfDone({ ...m, reply: doc.payload.introduction as unknown as JsonObject, replyCard: doc.payload.card as JsonObject, replyForwarded: true, vouchersSent: true })
      return { state: withAct(state as HolderState, next), outbound: [draft(p.toRequester!), ...p.vouchers.map(draft)] }
    }
    if (p.ignore) return { state: state as HolderState }
    const q = held(state, 'requester', r.act)!
    const via = arrivalContact(state, q.pins.mediator!)
    const opened = openIntroduced(state, q.ownLabel!, state.register.pairNonces[q.ownLabel!], rkidOf(state, q.ownLabel!), doc.payload.card, via, q.peerName, arr.when)
    let next: IntroAct = { ...q, status: 'completed', reply: doc.payload.introduction as unknown as JsonObject, replyCard: doc.payload.card as JsonObject }
    // the pending voucher, re-evaluated (8600, 8770)
    let st = opened.state
    if (q.pendingVoucher) {
      // matched it is accepted and retained; unmatched it vouches for nothing and goes
      next = voucherMatches(next, q.pendingVoucher as Doc)
        ? { ...next, pendingVoucher: null, voucher: q.pendingVoucher, vouched: true }
        : { ...next, pendingVoucher: null }
      if (next.vouched) st = markVouched(st, next)
    }
    return { state: withAct(st, next), events: opened.events, duties: opened.duties }
  },
}

/** The own key-agreement id a label derives under, from `addresses`. */
function rkidOf (state: Readonly<HolderState>, label: string): string {
  for (const [rkid, k] of Object.entries(state.addresses.keys)) if (k.label === label) return rkid
  throw new Error(`introduction: no address key for ${label}`)
}

// ── the ack at the requester (8680) ────────────────────────────────────

const ackTask: TaskHandler<{ introduction: Artifact<AckBody> }, { ok: boolean }> = {
  proof: 'absent',
  decode: (p) => (introSchemaOk('visibility-payload-introduction-ack.schema.json', p) ? p as { introduction: Artifact<AckBody> } : refuse('malformed')),
  async prepare (ctx, doc, arr) {
    const q = held(ctx.snapshot, 'requester', doc.payload.introduction.body.act)
    const at = arrival(ctx.snapshot, arr.rkid)!
    if (!q || q.pins.mediator !== at.label) return refuse('validation-failed', 'RLTP-TRU-8680')
    // after the absolute lifetime, whether or not tick ran (8300)
    if (lifetimeOver(q, ctx.when)) return refuse('validation-failed', 'RLTP-TRU-8300')
    const key = await pinKey(ctx, q.pins.mediator, MAC_ACK_INFO)
    if (!key || !(await introMacOk(doc.payload.introduction, key, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-8680')
    return { ok: true }
  },
  // sent → acked; absorbed after completion (8330); ignored after failed (8710)
  apply (state, _p, doc, arr) {
    const q = held(state, 'requester', doc.payload.introduction.body.act)!
    if (requesterStatus(q, arr.when) !== 'sent') return { state: state as HolderState }
    return { state: withAct(state as HolderState, { ...q, status: 'acked' }) }
  },
}

// ── vouchers at both sides (8.5) ───────────────────────────────────────

const voucherMatches = (a: Readonly<IntroAct>, v: Doc): boolean => {
  const own = a.role === 'requester'
  const requesterPair = (a.requestCard as Doc).anchor
  const targetPair = (a.replyCard as Doc | null)?.anchor
  return v.body.requesterPair === requesterPair && targetPair !== undefined && v.body.targetPair === targetPair && (own || a.role === 'target')
}

/** The relationship the act made, marked as vouched by the mediator. */
function markVouched (state: HolderState, a: Readonly<IntroAct>): HolderState {
  const at = a.ownLabel ? tupleByLabel(state, a.ownLabel) : null
  if (!at) return state
  const rel = at.rel
  return { ...state, relationships: { ...state.relationships, [rel.id]: { ...rel, memory: { ...rel.memory, vouchedBy: arrivalContact(state, a.pins.mediator!) } } } }
}

const voucherTask: TaskHandler<{ voucher: Artifact<VoucherBody> }, { role: 'requester' | 'target' }> = {
  proof: 'absent',
  decode: (p) => (introSchemaOk('visibility-payload-introduction-voucher.schema.json', p) ? p as { voucher: Artifact<VoucherBody> } : refuse('malformed')),
  async prepare (ctx, doc, arr) {
    const act = doc.payload.voucher.body.act
    const at = arrival(ctx.snapshot, arr.rkid)!
    const a = [held(ctx.snapshot, 'requester', act), held(ctx.snapshot, 'target', act)].find((x) => x && x.pins.mediator === at.label)
    // a held act within its lifetime, role-terminal states included (8760, 8290)
    if (!a || lifetimeOver(a, ctx.when)) return refuse('validation-failed', 'RLTP-TRU-8760')
    const key = await pinKey(ctx, a.pins.mediator!, MAC_VOUCHER_INFO)
    if (!key || !(await introMacOk(doc.payload.voucher, key, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-8730')
    return { role: a.role as 'requester' | 'target' }
  },
  // 8260: a repeat is byte-identical in JCS(body) (8210) and ignored, a
  // differing one rejected — against the accepted voucher, retained until
  // the lifetime (8200), and against a pending one alike
  apply (state, prepared, doc) {
    const v = doc.payload.voucher as unknown as Doc
    const a = held(state, prepared.value.role, v.body.act)!
    const kept = (a.voucher ?? a.pendingVoucher) as Doc | null
    if (kept) return jcs(kept.body) === jcs(v.body) ? { state: state as HolderState } : refuse('validation-failed', 'RLTP-TRU-8260')
    if (a.reply === null) return { state: withAct(state as HolderState, { ...a, pendingVoucher: v as JsonObject }) }   // 8770
    if (!voucherMatches(a, v)) return refuse('validation-failed', 'RLTP-TRU-8760')
    const next = { ...a, voucher: v as JsonObject, vouched: true }
    return { state: withAct(markVouched(state as HolderState, next), next) }
  },
}

// ── time: the transitions and the discard (8140, 8340, 8310) ───────────

function retainActs (state: Readonly<HolderState>, when: Millis): HolderState {
  let out: Record<string, IntroAct> | null = null
  for (const a of Object.values(state.encounter.introductions)) {
    if (lifetimeOver(a, when)) {
      out ??= { ...state.encounter.introductions }
      delete out[a.key]
      continue
    }
    if (a.role === 'requester') {
      const st = requesterStatus(a, when)
      if (st !== a.status) (out ??= { ...state.encounter.introductions })[a.key] = { ...a, status: st }
    }
  }
  // offers leave with their prompt
  const offers = Object.values(state.encounter.offers).filter((o) => !Object.hasOwn(state.prompts, o.id))
  if (!out && !offers.length) return state as HolderState
  const kept = { ...state.encounter.offers }
  for (const o of offers) delete kept[o.id]
  return { ...state, encounter: { ...state.encounter, introductions: out ?? state.encounter.introductions, offers: kept } }
}

/** When retainActs changes something: a requester's timeout fires, an
 *  act's absolute lifetime ends (the timer contract, engine.ts). */
function actDeadlines (state: Readonly<HolderState>): Millis[] {
  const out: Millis[] = []
  for (const a of Object.values(state.encounter.introductions)) {
    out.push(actFiresAt(a.issuedAt + ACT_EXPIRY + ACT_SKEW))
    if (a.role === 'requester' && a.status === 'sent') out.push(actFiresAt(a.at + a.ackDelayMs + ACT_SKEW))
    if (a.role === 'requester' && a.status === 'acked') out.push(actFiresAt(a.at + ACT_EXPIRY))
  }
  return out
}

/** The own rkids of every tuple a held act pinned (8270): a chaining
 *  during the act deactivates such a tuple, but the act's artifacts stay
 *  on it and verify under its key until the absolute lifetime (8290), when
 *  retainActs discards the act and with it this claim. */
function pinnedKeys (state: Readonly<HolderState>): string[] {
  const out = new Set<string>()
  for (const a of Object.values(state.encounter.introductions)) {
    for (const label of [a.pins.requester, a.pins.target, a.pins.mediator]) {
      const at = label === undefined ? null : tupleByLabel(state, label)
      if (at) out.add(at.tuple.rkid)
    }
  }
  return [...out]
}

/** The introduction module createHolder registers. */
export function introductionModule (): HolderModule {
  return Object.freeze({
    name: 'introduction',
    commands: Object.freeze({ [INTRODUCTION_COMMANDS.introduce]: introduceDef }),
    tasks: Object.freeze({
      [DECLARATION_TYPE]: declarationTask,
      [OFFER_TYPE]: offerTask,
      [INTRODUCTION_TYPES.request]: requestTask,
      [INTRODUCTION_TYPES.forward]: forwardTask,
      [INTRODUCTION_TYPES.reply]: replyTask,
      [INTRODUCTION_TYPES.ack]: ackTask,
      [INTRODUCTION_TYPES.voucher]: voucherTask,
    }),
    duties: Object.freeze({ 'intro-ack': ackDuty }),
    decisions: Object.freeze({ introduction: introductionDecision }),
    retain: retainActs,
    deadlines: actDeadlines,
    keepKeys: pinnedKeys,
  })
}
