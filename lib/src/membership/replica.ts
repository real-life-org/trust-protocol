// membership/replica — the holder's side of the group log (access stage 1,
// rltp design 2026-11): the stored log of a group and its materialization
// into the roster, the one step every arrival and every own operation
// takes (advance), and what the module registers for the exchange:
//
//   tasks     x-access-entry/0.1, x-access-sync/0.1, x-access-page/0.1
//             (proof absent, the arrival tuple's binding: they travel on
//             the pair channel of two members; access/exchange.ts has the
//             forms and the rules, DEVIATION D1 their standing)
//   commands  membership.leave   the own member.leave (human)
//             membership.sync    a request to every invitation edge of a
//                                group, or to the welcome's issuer while
//                                joining: the app's cue is its resume
//                                (coming back online)
//
// Who is heard (S1-8, S1-13): the sender is the contact of the arrival
// tuple; it is a member where a roster entry (the materialization) carries
// that contact, which only an invitation edge does: the member this holder
// invited, or the one that invited it (prelude, invitation, welcome). A
// `member:` pseudo-contact is never a sender. While joining, only the
// welcome's issuer is heard: its entries are buffered, its pages judged.
// A document from anyone else, for a group this holder does not hold, has
// left, or whose join is void, is validation-failed: nothing buffered,
// nothing answered. A blocked relationship is no edge.
//
// Dispositions (Delivery 6.2; S1-22): schema → malformed (stage 7); the
// sender, the group, the form of every entry → validation-failed; the
// bounds of held entries → rate-limited; each without an ack. Buffered,
// held, applied, known, and a request answered are the defined effect.
//
// The gate (S1-6): only a member by its own materialization authors
// (invites, admits, leaves) and answers. A group is `joining` from its
// welcome until the log confirms the own admission (recognized by the
// accept's digest in a canonical member.add), `void` where the admission
// is canonical yet defeated by a leave, or not canonical once the issuer's
// answer is complete, or unconfirmed at joinUntil.
import { sameDigest, toU } from '../core.js'
import type { Json, JsonObject } from '../core.js'
import { digestDoc } from '../crypto.js'
import {
  ADD_OP, ENTRY_TYPE, GENESIS_OP, LEAVE_OP, PAGE_TYPE, SYNC_TYPE, dropHeld, exchangePayloadOk, expireHeld, forwards, haveOf, intake, materialize, opUnsigned, oversize, pageOf, releaseJoining, signEnvelope, stillWanted, noteUnavailable, WANT_MAX,
} from '../access/index.js'
import type { Edge, EntryPayload, Envelope, GroupLog, Materialized, PagePayload, Replica, SyncPayload } from '../access/index.js'
import type { CommandDef, EventDraft, PrepareCtx, Refusal, TaskHandler } from '../engine.js'
import type { Applied } from '../engine.js'
import type { Group, GroupLogState, GroupPhase, HolderState, Millis, RosterEntry } from '../state.js'
import { blockedRel } from '../message/holder.js'
import { findContact } from '../trust/state.js'
import { groupStarRematch, withGroupHits } from '../trust/group-star.js'
import type { GroupStarRehit } from '../trust/group-star.js'
import type { GroupMembership } from '../group-star.js'
import { iso } from '../core.js'
import { arrival, channelTo, draft, isRefusal, no, refuse, sealed, signer } from './shared.js'
import type { Sealed } from './shared.js'

export { ENTRY_TYPE, SYNC_TYPE, PAGE_TYPE }

/** The longest give-up horizon (Delivery [P1D, P90D]): how long an own request may wait for its page. */
const HORIZON_MAX = 90 * 86_400_000
const HELD_LIFETIME = 90 * 86_400_000
/** the partition of the holder's own operations (never held) */
const SELF = 'self'

// ── the stored log ─────────────────────────────────────────────────────

/** The group's log and repairs as access/* reads them, or null for a group held without a log. */
export const replicaOf = (g: Readonly<Group>): Replica | null => (g.log
  ? { log: { genesisDigest: g.log.genesisDigest, accepted: g.log.accepted as unknown as GroupLog['accepted'], held: g.log.held as unknown as GroupLog['held'] }, repairs: g.log.repairs }
  : null)

/** The stored form: the stage mark is local, outside every envelope. */
export const storedLog = (r: Replica): GroupLogState => ({
  'x-rltp-access-stage': 1, genesisDigest: r.log.genesisDigest,
  accepted: r.log.accepted as unknown as GroupLogState['accepted'], held: r.log.held as unknown as GroupLogState['held'], repairs: r.repairs,
})

/** The genesis envelope of a held log. */
export const genesisEnvelope = (g: Readonly<Group>): JsonObject | undefined =>
  (g.log ? Object.values(g.log.accepted).find((e) => (e as { op?: string }).op === GENESIS_OP) : undefined)

/** A materialization with the display names of its members' cards. */
export interface Facts { m: Materialized, names: Record<string, string> }

export async function factsOf (log: GroupLog, subtle: SubtleCrypto): Promise<Facts> {
  const m = await materialize(log, subtle)
  const names: Record<string, string> = {}
  for (const a of m.members) {
    const env = log.accepted[m.memberOp[a]!]!
    const card = (env.op === GENESIS_OP ? (env.body as any).card : (env.body as any).admission.accept.payload.accept.card) as { name?: unknown }
    if (typeof card?.name === 'string') names[a] = card.name
  }
  return { m, names }
}

type EdgeOf = Record<string, { contactId: string, rkid: string }>

/** The roster a materialization yields: its members, each with what the
 *  holder knows locally (since when; the contact and tuple of an
 *  invitation edge: carried over, given in `edges`, or the issuer's). */
export function rosterOf (g: Readonly<Group>, f: Facts, when: Millis, edges: EdgeOf = {}): Record<string, RosterEntry> {
  const out: Record<string, RosterEntry> = {}
  for (const a of f.m.members) {
    const prev = g.phase === 'member' && Object.hasOwn(g.roster, a) ? g.roster[a] : undefined
    const edge = Object.hasOwn(edges, a) ? edges[a]
      : prev?.contactId !== undefined && prev.rkid !== undefined ? { contactId: prev.contactId, rkid: prev.rkid }
        : g.issuer?.anchor === a && g.issuer.contactId !== undefined && g.issuer.rkid !== undefined ? { contactId: g.issuer.contactId, rkid: g.issuer.rkid } : undefined
    out[a] = {
      anchor: a, op: f.m.memberOp[a]!, keyAgreement: f.m.keyAgreement[a]!, ...(Object.hasOwn(f.names, a) ? { name: f.names[a] } : {}),
      addedAt: prev?.addedAt ?? when, ...(edge && a !== g.memberAnchor ? edge : {}),
    }
  }
  return out
}

/** the holder's entry id of a contact (a merged entry answers under its aliases) */
const entryId = (state: Readonly<HolderState>, contactId: string): string => findContact(state, contactId)?.id ?? contactId

/** The invitation edges of a roster: the members it knows as a contact. */
const edgesOf = (state: Readonly<HolderState>, roster: Readonly<Record<string, RosterEntry>>, own: string | undefined): Edge[] =>
  Object.values(roster).filter((m) => m.contactId !== undefined && m.anchor !== own).map((m) => ({ member: m.anchor, contact: entryId(state, m.contactId!) }))

/** The group a payload addresses: by genesis digest (3065), its DID the one the log's genesis names. */
function groupFor (state: Readonly<HolderState>, p: { group: string, genesisDigest: string }): Group | null {
  const id = toU(p.genesisDigest)
  const g = id !== null && Object.hasOwn(state.groups, id) ? state.groups[id] : undefined
  return g && g.log && g.did === p.group ? g : null
}

/** The sender of a document on the arrival tuple, as the group hears it
 *  (the header): the contact's entry id, or null for anyone not heard. */
function senderOf (state: Readonly<HolderState>, g: Readonly<Group>, rkid: string): string | null {
  const a = arrival(state, rkid)
  if (!a || blockedRel(state, a.rel.id)) return null
  const from = entryId(state, a.contactId)
  if (g.phase === 'joining') return g.issuer?.contactId !== undefined && entryId(state, g.issuer.contactId) === from ? from : null
  if (g.phase !== 'member') return null
  return edgesOf(state, g.roster, g.memberAnchor).some((e) => e.contact === from) ? from : null
}

// ── documents on the pair channel ──────────────────────────────────────

/** A document of the exchange toward a contact, on the live tuple of the
 *  relationship (no proof: the envelopes carry the signatures), or null
 *  where no channel leads there or the relationship is blocked. */
async function pairDoc (ctx: PrepareCtx, contactId: string, type: string, payload: unknown): Promise<Sealed | null> {
  const ch = channelTo(ctx.snapshot, contactId)
  if (!ch || blockedRel(ctx.snapshot, ch.rel.id)) return null
  const own = await ctx.keys.anchorOf(ch.tuple.ownPairLabel)
  const doc = { id: ctx.entropy.id('doc.id'), type, issuer: own.anchor, recipient: ch.tuple.counterpartAnchor, threadId: ctx.entropy.id('thread.id'), issuedAt: iso(ctx.when), payload }
  return sealed(ctx, doc, { contactId: ch.contact.id, rkid: ch.tuple.rkid, keyAgreement: ch.tuple.counterpartKeyAgreement })
}

const head = (g: Readonly<Group>) => ({ group: g.did ?? '', genesisDigest: g.id })

/** The own admission in a log: whether a member.add carrying the accept's digest is accepted, and canonical. */
async function ownAdmission (log: GroupLog, m: Materialized, acceptDigest: string | undefined, subtle: SubtleCrypto): Promise<'canonical' | 'not-canonical' | null> {
  if (acceptDigest === undefined) return null
  let found: 'not-canonical' | null = null
  for (const [id, env] of Object.entries(log.accepted)) {
    if (env.op !== ADD_OP) continue
    let d: string
    try { d = await digestDoc((env.body as any).admission.accept, subtle) } catch { continue }
    if (!sameDigest(d, acceptDigest)) continue
    if (m.verdict[id] === 'canonical') return 'canonical'
    found = 'not-canonical'
  }
  return found
}

// ── the step ───────────────────────────────────────────────────────────

/** What one intake leaves: the group as it stands after it, the documents
 *  it sends, its events, and the group-star hits of a join. */
export interface Step { group: Group, outbound: Sealed[], events: EventDraft[], hits: GroupStarRehit[] }
export type Advance = Step | { refused: 'rate-limited' | 'validation-failed' }
export const isStep = (a: Advance): a is Step => !('refused' in a)

export interface From {
  /** the sender's entry id; null for the holder's own operation */
  source: string | null
  /** the entries answer the own request on this thread, with the page's end and what the request asked for by name */
  page?: { thread: string, next?: string, last: boolean, asked?: string[] }
  /** invitation edges this step creates, by member anchor */
  edges?: EdgeOf
}

/** Takes entries into a group's log and draws every consequence
 *  (access/exchange.ts): the roster, the own phase, forwarding, the repair
 *  request, the next page. Runs in a preparation, against its snapshot;
 *  the commit is CAS on that snapshot's version (engine.ts), so `group`
 *  lands on the state it was computed from. */
export async function advance (ctx: PrepareCtx, g: Readonly<Group>, entries: readonly unknown[], from: From): Promise<Advance> {
  const S = ctx.crypto.subtle
  const state = ctx.snapshot
  const joining = g.phase === 'joining'
  const i = await intake(replicaOf(g)!, entries, { source: from.source ?? SELF, now: ctx.when, ...(joining && !from.page ? { buffer: true } : {}), ...(from.page ? { answers: true } : {}) }, S)
  if (i.disposition !== 'effect') return { refused: i.disposition }
  let replica = i.replica
  // the last page of a request that named parents: what it did not bring, the source lacks (remembered per repair)
  if (from.page?.last && from.page.asked && from.source !== null) replica = noteUnavailable(replica, from.source, from.page.asked)
  // a page that answers a repair: every continuation asks for what the held entries still miss by name, not by cursor
  const wanted = from.page && from.source !== null ? stillWanted(replica, from.source, ctx.when) : []
  let facts = await factsOf(replica.log, S)
  const outbound: Sealed[] = []
  const events: EventDraft[] = []
  let hits: GroupStarRehit[] = []
  const syncs = { ...g.syncs }
  if (from.page) delete syncs[from.page.thread]
  const ask = async (contactId: string, more: { want?: string[], cursor?: string }): Promise<void> => {
    const doc = await pairDoc(ctx, contactId, SYNC_TYPE, { ...head(g), have: haveOf(facts.m), ...more } satisfies SyncPayload)
    if (!doc) return
    outbound.push(doc)
    syncs[doc.threadId] = { contactId: doc.recipient.contactId, rkid: doc.recipient.rkid, at: ctx.when, ...(more.want ? { want: more.want } : {}) }
  }
  /** a repair is over when nothing is left to name; a last page ends one request, not the repair:
   *  the whole outstanding set (less what the source lacks, noteUnavailable) is cut to one request's bound last */
  const remaining = (): string[] =>
    [...new Set([...wanted, ...(i.want ?? [])])].filter((p) => !Object.hasOwn(replica.log.accepted, p) && !Object.hasOwn(replica.log.held, p)).sort().slice(0, WANT_MAX)
  const { joinUntil: _until, ...base } = g
  const mine = g.memberAnchor

  // 1. every effect on the log first: the joining buffer is judged once the
  //    admission is confirmed (a buffered leave of the own key may defeat it)
  if (joining && mine !== undefined && facts.m.members.includes(mine)) {
    const rel = await releaseJoining(replica.log, S)
    if (rel.log !== replica.log) { replica = { log: rel.log, repairs: replica.repairs }; facts = await factsOf(rel.log, S) }
  }
  // 2. the standing, decided once from the materialization after all of it
  const adm = joining && !(mine !== undefined && facts.m.members.includes(mine)) ? await ownAdmission(replica.log, facts.m, g.acceptDigest, S) : null
  const standing = standingOf(g, facts.m, adm, from.page?.last === true)
  // 3. the group, from the standing alone
  let next: Group
  if (standing === 'member' && joining) {
    // joined: the group stands in the star and answers
    const m = facts.m
    const membership: GroupMembership = {
      group: g.id,
      isMember: (a) => m.members.includes(a),
      resolve: (oid) => { const a = m.members.find((x) => m.memberOp[x] === oid); return a === undefined ? null : { subject: a, keyAgreement: m.keyAgreement[a]! } },
    }
    hits = await groupStarRematch(ctx, membership)
    next = { ...base, phase: 'member', listed: true, memberOp: m.memberOp[mine!]!, roster: rosterOf(g, facts, ctx.when) }
    events.push({ type: 'group.joined', groupId: g.id })
    // once more at the issuer, for what it accepted meanwhile (S1-11)
    if (g.issuer?.contactId !== undefined) await ask(g.issuer.contactId, {})
  } else if (standing === 'void') {
    // canonical yet defeated by a leave, or not canonical with the answer complete
    replica = { log: dropHeld(replica.log), repairs: {} }
    for (const t of Object.keys(syncs)) delete syncs[t]
    next = { ...base, phase: 'void', roster: {}, endedAt: ctx.when }
    events.push({ type: 'group.void', groupId: g.id })
  } else if (standing === 'joining') {
    next = { ...g }
    if (from.page && from.source !== null) {
      const want = remaining()
      if (want.length) await ask(from.source, { want })
      else if (!from.page.last && from.page.next !== undefined) await ask(from.source, { cursor: from.page.next })
    } else if (i.want !== null && from.source !== null) await ask(from.source, { want: i.want })
  } else if (standing === 'left') {
    // the holder is no member by its own log any more: its own leave, here
    // or applied elsewhere and exchanged, or a dissolve beside it. What it
    // accepted still travels to the members it knows (5700); then it hears
    // nothing more
    const roster = rosterOf(g, facts, ctx.when)
    for (const f of forwards(replica.log, facts.m, i.applied, edgesOf(state, roster, mine), from.source)) {
      for (const entry of f.entries) {
        const doc = await pairDoc(ctx, f.edge.contact, ENTRY_TYPE, { ...head(g), entry } satisfies EntryPayload)
        if (doc) outbound.push(doc)
      }
    }
    const { memberOp: _op, ...rest } = base
    replica = { log: { ...replica.log, held: {} }, repairs: {} }
    for (const t of Object.keys(syncs)) delete syncs[t]
    next = { ...rest, phase: 'left', listed: false, roster, invitations: {}, evidence: {}, preludes: {}, endedAt: ctx.when }
    events.push({ type: 'group.left', groupId: g.id })
  } else {
    const roster = rosterOf(g, facts, ctx.when, from.edges)
    for (const a of Object.keys(roster)) if (!Object.hasOwn(g.roster, a)) events.push({ type: 'group.admitted', groupId: g.id, member: a })
    for (const a of Object.keys(g.roster)) if (!Object.hasOwn(roster, a) && a !== mine) events.push({ type: 'group.departed', groupId: g.id, member: a })
    // a member needs no invitation and no pending consent: whoever admitted it
    const invitations = Object.fromEntries(Object.entries(g.invitations).filter(([, x]) => !Object.hasOwn(roster, x.invitee)))
    const evidence = Object.fromEntries(Object.entries(g.evidence).filter(([, e]) => !Object.hasOwn(roster, (e.accept as any).payload?.accept?.subject)))
    // the own admission is the one the materialization names (the smallest id where concurrent)
    next = { ...g, roster, invitations, evidence, memberOp: facts.m.memberOp[mine!]! }
    for (const f of forwards(replica.log, facts.m, i.applied, edgesOf(state, roster, mine), from.source)) {
      for (const entry of f.entries) {
        const doc = await pairDoc(ctx, f.edge.contact, ENTRY_TYPE, { ...head(g), entry } satisfies EntryPayload)
        if (doc) outbound.push(doc)
      }
    }
    // the next page brings the difference, the missing parents with it; otherwise the repair asks for them by name
    if (from.page && from.source !== null) {
      const want = remaining()
      if (want.length) await ask(from.source, { want })
      else if (!from.page.last && from.page.next !== undefined) await ask(from.source, { cursor: from.page.next })
    } else if (i.want !== null && from.source !== null) await ask(from.source, { want: i.want })
  }
  const group: Group = { ...next, log: storedLog(replica), syncs }
  // 4. the standing invariant, before anything commits
  const bad = standingProblem(group, facts.m)
  if (bad) throw new Error(`access: ${g.id}: ${bad}`)
  return { group, outbound, events, hits }
}

/** The holder's standing in a group, decided once, from the materialization
 *  after every effect on the log (the buffer released, held entries healed):
 *  a member exactly when its anchor is a member there with a canonical
 *  admission; from joining, void where the own admission is canonical yet
 *  defeated, or not canonical once the issuer's answer is complete; from
 *  member, left once the anchor is gone. void and left are terminal. */
export function standingOf (g: Readonly<Pick<Group, 'phase' | 'memberAnchor'>>, m: Materialized, ownAdmission: 'canonical' | 'not-canonical' | null, answerComplete: boolean): GroupPhase {
  const mine = g.memberAnchor
  const member = mine !== undefined && m.members.includes(mine) && m.memberOp[mine] !== undefined
  if (g.phase === 'joining') return member ? 'member' : ownAdmission === 'canonical' || (ownAdmission === 'not-canonical' && answerComplete) ? 'void' : 'joining'
  if (g.phase === 'member') return member ? 'member' : 'left'
  return g.phase
}

/** What a group's stored standing must satisfy against its materialization
 *  (the invariant every step checks before it commits, and invariants.ts
 *  checks on every commit): a member carries its anchor, its canonical
 *  admission as memberOp and the materialized members as its roster; a
 *  listed group is a member; joining carries no memberOp; void and left
 *  are unlisted with no open request. */
export function standingProblem (g: Readonly<Group>, m: Materialized): string | null {
  const mine = g.memberAnchor
  if (g.phase === 'member') {
    if (mine === undefined || !m.members.includes(mine)) return 'a member whose anchor is not a member of its log'
    if (g.memberOp !== m.memberOp[mine]) return 'memberOp is not the canonical admission'
    const roster = Object.keys(g.roster).sort()
    if (roster.join() !== [...m.members].sort().join()) return 'the roster is not the materialized membership'
  } else {
    if (g.listed) return 'a listed group whose holder is no member'
    if (g.phase === 'joining' && g.memberOp !== undefined) return 'a joining group with a memberOp'
    if ((g.phase === 'void' || g.phase === 'left') && Object.keys(g.syncs).length) return 'a terminal group with an open request'
  }
  return null
}

/** The commit of a step. */
export const committed = (state: Readonly<HolderState>, step: Step): Applied => ({
  state: withGroupHits({ ...state, groups: { ...state.groups, [step.group.id]: step.group } }, step.hits, step.group.id),
  outbound: step.outbound.map(draft),
  events: step.events,
})

/** An operation the holder authors at its position (prev = heads), signed
 *  under its member anchor; 'oversize' where it exceeds the entry bound
 *  (5330). The caller holds the gate: a member with a log. */
export async function authored (ctx: PrepareCtx, g: Readonly<Group>, op: typeof ADD_OP | typeof LEAVE_OP, body: Json): Promise<Envelope | 'oversize'> {
  const S = ctx.crypto.subtle
  const r = replicaOf(g)!
  const env = await signEnvelope(opUnsigned(r.log, await materialize(r.log, S), op, g.memberAnchor!, body as Envelope['body']), [{ signer: g.memberAnchor!, sign: signer(ctx, g.memberLabel) }], S)
  return oversize(env) ? 'oversize' : env
}

// ── the tasks ──────────────────────────────────────────────────────────

const entryTask: TaskHandler<EntryPayload, Step> = {
  proof: 'absent',
  decode: (p) => (exchangePayloadOk(ENTRY_TYPE, p) ? p as EntryPayload : refuse('malformed')),
  async prepare (ctx, doc, arr) {
    const g = groupFor(ctx.snapshot, doc.payload)
    const source = g && senderOf(ctx.snapshot, g, arr.rkid)
    if (!g || source === null || source === undefined) return refuse('validation-failed')
    const step = await advance(ctx, g, [doc.payload.entry], { source })
    return isStep(step) ? step : refuse(step.refused)
  },
  apply: (state, prepared) => committed(state, prepared.value),
}

const syncTask: TaskHandler<SyncPayload, Sealed> = {
  proof: 'absent',
  decode: (p) => (exchangePayloadOk(SYNC_TYPE, p) ? p as SyncPayload : refuse('malformed')),
  // answered only to a current member, on the channel of the request, by a
  // member (5690: never to one who left); the answer keeps no state
  async prepare (ctx, doc, arr) {
    const g = groupFor(ctx.snapshot, doc.payload)
    if (!g || g.phase !== 'member' || senderOf(ctx.snapshot, g, arr.rkid) === null) return refuse('validation-failed')
    const a = arrival(ctx.snapshot, arr.rkid)!
    const own = await ctx.keys.anchorOf(a.label)
    const page = pageOf(replicaOf(g)!.log, doc.payload)
    const body = { id: ctx.entropy.id('doc.id'), type: PAGE_TYPE, issuer: own.anchor, recipient: doc.issuer, threadId: doc.threadId, issuedAt: iso(ctx.when), payload: { ...head(g), ...page } satisfies PagePayload }
    return sealed(ctx, body, { contactId: a.contactId, rkid: arr.rkid, keyAgreement: a.tuple.counterpartKeyAgreement })
  },
  apply: (state, prepared) => ({ state: state as HolderState, outbound: [draft(prepared.value)] }),
}

const pageTask: TaskHandler<PagePayload, Step> = {
  proof: 'absent',
  decode: (p) => (exchangePayloadOk(PAGE_TYPE, p) ? p as PagePayload : refuse('malformed')),
  // taken only as the answer to an own request: on its thread, on the tuple it went on
  async prepare (ctx, doc, arr) {
    const g = groupFor(ctx.snapshot, doc.payload)
    const asked = g && Object.hasOwn(g.syncs, doc.threadId) ? g.syncs[doc.threadId] : undefined
    const source = g && senderOf(ctx.snapshot, g, arr.rkid)
    if (!g || !asked || asked.rkid !== arr.rkid || source === null || source === undefined) return refuse('validation-failed')
    const p = doc.payload
    const step = await advance(ctx, g, p.entries, { source, page: { thread: doc.threadId, ...(p.next !== undefined ? { next: p.next } : {}), last: p.last, ...(asked.want ? { asked: asked.want } : {}) } })
    return isStep(step) ? step : refuse(step.refused)
  },
  apply: (state, prepared) => committed(state, prepared.value),
}

export const EXCHANGE_TASKS = Object.freeze({ [ENTRY_TYPE]: entryTask, [SYNC_TYPE]: syncTask, [PAGE_TYPE]: pageTask })

// ── the commands ───────────────────────────────────────────────────────

export interface LeaveInput { groupId: string }
export interface SyncInput { groupId?: string }

/** The own member.leave (Access 5.4 in the reading of stage 1, DEVIATION
 *  D2): authored at the own position, effective at once, forwarded along
 *  the invitation edges; the holder then holds the group as left and hears
 *  nothing more of it. A leave as the sole member dissolves the group
 *  (4410). */
export const leaveDef = (personal: (state: Readonly<HolderState>, groupId: string) => boolean): CommandDef<LeaveInput, Refusal | Step> => ({
  human: true,
  async prepare (ctx, input) {
    const g = ctx.snapshot.groups[input?.groupId]
    if (!g || !g.log) return no('unknown-group')
    if (personal(ctx.snapshot, g.id)) return no('personal-community')
    if (g.phase !== 'member') return no('not-yet-canonical')
    const env = await authored(ctx, g, LEAVE_OP, {})
    if (env === 'oversize') return no('oversize')
    const step = await advance(ctx, g, [env], { source: null })
    // the own leave took effect: the step left the group (standingOf)
    if (!isStep(step) || step.group.phase !== 'left') return no('not-yet-canonical')
    return step
  },
  apply (state, prepared) {
    const p = prepared.value
    return isRefusal(p) ? p : committed(state, p)
  },
})

interface SyncPrep { asked: Array<{ groupId: string, doc: Sealed }> }

/** Requests toward every invitation edge of the holder's groups (or of
 *  one): what a holder does when it comes back (S1-11). While joining, the
 *  request goes to the welcome's issuer again. */
export const syncDef: CommandDef<SyncInput, Refusal | SyncPrep> = {
  human: false,
  async prepare (ctx, input) {
    const s = ctx.snapshot
    if (input?.groupId !== undefined && !Object.hasOwn(s.groups, input.groupId)) return no('unknown-group')
    const asked: SyncPrep['asked'] = []
    for (const g of Object.values(s.groups)) {
      if ((input?.groupId !== undefined && g.id !== input.groupId) || !g.log) continue
      const to = g.phase === 'member' ? edgesOf(s, g.roster, g.memberAnchor).map((e) => e.contact) : g.phase === 'joining' && g.issuer?.contactId !== undefined ? [g.issuer.contactId] : []
      if (!to.length) continue
      const have = haveOf(await materialize(replicaOf(g)!.log, ctx.crypto.subtle))
      for (const contactId of to) {
        const doc = await pairDoc(ctx, contactId, SYNC_TYPE, { ...head(g), have } satisfies SyncPayload)
        if (doc) asked.push({ groupId: g.id, doc })
      }
    }
    return { asked }
  },
  apply (state, prepared, _input, when) {
    const p = prepared.value
    if (isRefusal(p)) return p
    if (!p.asked.length) return { state: state as HolderState }
    const groups = { ...state.groups }
    for (const { groupId, doc } of p.asked) groups[groupId] = { ...groups[groupId], syncs: { ...groups[groupId].syncs, [doc.threadId]: { contactId: doc.recipient.contactId, rkid: doc.recipient.rkid, at: when } } }
    return { state: { ...state, groups }, outbound: p.asked.map((a) => draft(a.doc)) }
  },
}

// ── retention ──────────────────────────────────────────────────────────

/** What tick lets go of the exchange: an own request past the give-up
 *  horizon; a join unconfirmed at joinUntil becomes void, its buffer
 *  dropped; of a group left or void, the log and the roster a horizon
 *  after the standing ended (the entry stays: its name and phase). A tick commit carries no events (engine.ts): the app sees this
 *  void through subscribe and GroupView.phase, not as group.void, which
 *  only a page that defeats the join announces. */
export function retainExchange (g: Readonly<Group>, when: Millis): Group {
  let next = g as Group
  if (g.log) {
    const r = replicaOf(g)!
    const log = expireHeld(r.log, when)
    if (log !== r.log) {
      const repairs = Object.fromEntries(Object.entries(r.repairs).filter(([id]) => Object.hasOwn(log.held, id)))
      next = { ...next, log: storedLog({ log, repairs }) }
    }
  }
  const stale = Object.entries(g.syncs).filter(([, s]) => s.at + HORIZON_MAX < when)
  if (stale.length) next = { ...next, syncs: Object.fromEntries(Object.entries(g.syncs).filter(([, s]) => s.at + HORIZON_MAX >= when)) }
  if (g.phase === 'joining' && g.joinUntil !== undefined && g.joinUntil < when) {
    const { joinUntil: _until, ...rest } = next
    next = { ...rest, phase: 'void', roster: {}, syncs: {}, endedAt: when, ...(g.log ? { log: { ...g.log, held: {}, repairs: {} } } : {}) }
  }
  // a standing that ended a horizon ago: the entry stays (name, phase), the log and the roster go
  if ((next.phase === 'left' || next.phase === 'void') && next.endedAt !== undefined && next.endedAt + HORIZON_MAX < when && (next.log !== undefined || Object.keys(next.roster).length)) {
    const { log: _log, ...kept } = next
    next = { ...kept, roster: {} }
  }
  return next
}

export function exchangeDeadlines (g: Readonly<Group>): Millis[] {
  const out = Object.values(g.syncs).map((s) => s.at + HORIZON_MAX + 1)
  for (const h of Object.values(g.log?.held ?? {})) out.push(h.since + HELD_LIFETIME + 1)
  if (g.phase === 'joining' && g.joinUntil !== undefined) out.push(g.joinUntil + 1)
  if ((g.phase === 'left' || g.phase === 'void') && g.endedAt !== undefined && (g.log !== undefined || Object.keys(g.roster).length)) out.push(g.endedAt + HORIZON_MAX + 1)
  return out
}
