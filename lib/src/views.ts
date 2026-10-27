// views — what an app reads: pure projections of the holder's state
// (lib Stage 2, note §4.5).
//
// `state → View`, synchronous, without the engine: every function here
// reads one state and returns fresh, deep-frozen objects that share no
// reference with it, so a UI can keep them and the state stays untouched.
// Each view carries the commitSeq of the state it was read from; views of
// one snapshot belong together. The holder hands them out over its
// snapshot (holder-api.ts); after a `subscribe` announcement the app
// re-reads them. Views never write: whatever ages state (expiry, the
// encounter's aging latch) is an act, never a read.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// Choices this file makes where the note leaves them open:
//   - contacts are listed in entry-commit order (2120); entries without a
//     position (2060) follow, by id. A contact is found by its entry id or
//     by any of its aliases (2140)
//   - provenance and via come from the contact's oldest relationship (by
//     its provenance time, then id): how the person came, not how often
//   - tuples belong to the entry their entryId names (2145): an entry's
//     tuples are those whose entryId is its id or one of its aliases, over
//     its own relationships and any relationship that stands behind two
//     entries. Its heads are the active-head tuples among them of live
//     relationships (not chained into another), not deactivated; under
//     2146 the appended tuple's entry takes the chain's active head
//   - verification is the edge of Encounter 4.2 over all of the entry's
//     tuples, deactivated and older ones included (historical evidence;
//     one edge per relationship, carried along its chain): `outgoing` an
//     own step credential was issued, `incoming` the counterparty's was
//     accepted (5.6), `mutual` both, `met` neither — read from the
//     enactment records of those tuples (encounter/ceremony.ts). An entry
//     with no record at all (built without a ceremony: introduced, or a
//     test state) reads the anchor mappings instead: `outgoing` one was
//     issued (mappingOut), `incoming` one was verified (mappingIn)
//   - displayName: the profile's name (6425), else the self-declared name
//     on the counterparty card of the entry's newest record (Encounter
//     6120: the app binds its own local name to the anchor)
//   - trust.given is the anchor mapping class on (the Trust act, 2770);
//     trust.received a verified anchor mapping from the contact, whose
//     class has no default recipient (2760); trust.paused the pause of 5.4,
//     star and blinded group star both `off` (2780); trust.pending: given,
//     but not yet out on every head (no mapping issued on it, or its
//     relationship lags (6595)), or a re-issue or class-on duty for the
//     anchor mapping is open at a version this library handles (a duty of
//     an unhandled version is opaque, note §2.1). Delivery of the documents is not part of
//     it; deliveryStatus answers that
//   - classes give the setting and whether the class is on toward the
//     contact (2760, 2840); the sealed group star also per group (2830):
//     every group of the holder and every group the contact holds a
//     per-group setting for, by id, with the setting (`default` where none
//     is held) and whether it is on for (group, contact) — the per-group
//     setting first, else the class (trust/group-star.ts sealedOn)
//   - sharedGroups: the union of the groups the last accepted group star
//     on each of the entry's heads hit (5520, trust/group-star.ts), lagging
//     heads included (the group star travels on them, 6595); undefined
//     where no head ever accepted one
//   - a contact's profile (6425): among the verified profile@1 bodies
//     (6b.2) on its heads whose relationship does not lag (6461, 6595),
//     the highest revision, among equal ones the one verified last
//     (highest verifiedSeq); displayName is that profile's name
//   - deliveryStatus(x) lists the outbox items whose digest or threadId is
//     x, by first submission, then digest; an unknown x lists none
//   - relationships: the entry's own (relIds), in that order; chainedFrom
//     the husks chained into each (chainedInto), by id; carrierNonce the
//     canonical register entry under the relationship's id;
//     counterpartDeliveryHints the deliveryHints of the counterparty card
//     on the record of the relationship's first tuple, whose relId is the
//     relationship's id (the enactment that opened it): a re-encounter's
//     record names the husk it opened, so its card never replaces the
//     first contact's hints. A chained relationship (a husk) is no
//     RelationshipView of its own, only an id in chainedFrom: it shows no
//     carrierNonce, because no adapter instance runs for it (profile
//     RLTP-VTI-1230)
//   - a contact without a relationship breaks an invariant and throws
import { freezeDeep } from './util-freeze.js'
import type { Json } from './core.js'
import { heldOf, triasOf } from './state.js'
import { CLASSES, activeTuple, classOn, findContact, lags, trusted as isTrusted, tupleByLabel } from './trust/state.js'
import { sealedOn } from './trust/group-star.js'
import { classOfDuty } from './trust/duties.js'
import { messageChannel } from './message/holder.js'
import { canonicalCarrierNonce } from './identity-state.js'
import type {
  EnactmentRecord,
  Contact, Dec, HolderState, Millis, OutboxItem, OutboxStatus, PromptKind, Relationship, Setting, TrustClass, Tuple,
} from './state.js'
import type { DeliveryFailure, PreTransportReason, ReceiverRefusalCode } from './ports.js'

/** One trust class toward one contact: its setting (2810) and whether it is on (2760). */
export interface ClassView { setting: Setting, on: boolean }

/** The sealed group star toward one contact: the class, and per group
 *  (2830) the per-group setting and whether it is on for (group, contact). */
export interface SealedClassView extends ClassView { groups: Record<string, ClassView> }

/** Every class toward one contact (2720), the sealed group star per group too. */
export type ClassesView = Record<Exclude<TrustClass, 'sealedGroupStar'>, ClassView> & { sealedGroupStar: SealedClassView }

/** A contact's verified profile (6b.2): string fields only. */
export interface ContactProfileView { revision: Dec, name?: string, image?: string, text?: string }

/** One contact, i.e. one entry of the deliverable set (2120, 2140). */
export interface ContactView {
  /** the commitSeq of the state this view was read from */
  commitSeq: Dec
  /** the entry id: stable across aliases (2140) and chains (6a.4) */
  id: string
  /** identities merged into this entry (2140) and the fresh contacts its
   *  chains took in (6a.4); contact(alias) finds it too */
  aliases: string[]
  /** its relationships (Contact.relIds), each with the number of tuples
   *  its chain holds (one per enactment that continued it, 6.4) and the
   *  fresh relationships chained into it (6a.4); a relationship that
   *  stands behind two entries (2145) is listed under both */
  relationships: RelationshipView[]
  /** the verified profile's name (6425); the ceremony card's name enters
   *  the state only when Encounter graduates (PR 7), so without a profile
   *  it is undefined */
  displayName?: string
  provenance: 'ceremony' | 'introduced'
  /** the introducer, for an introduced contact */
  via?: string
  verification: 'mutual' | 'outgoing' | 'incoming' | 'met'
  trust: { given: boolean, received: boolean, paused: boolean, pending: boolean }
  classes: ClassesView
  /** groups shared with the contact: the groups of the holder whose
   *  digest hit in the contact's last completed group star (5520), over
   *  its heads, sorted. A hit is the contact's claim (5.2, no veracity).
   *  Undefined while no group star was ever accepted on a head, never a
   *  claimed empty list. */
  sharedGroups?: string[]
  profile?: ContactProfileView
  /** a block holds on the contact's relationships (Message Tasks 6.1): an
   *  application shows no content and no offer of it, and shows group
   *  state and removal notices as without a block (6230) */
  blocked: boolean
  /** a message to the contact goes out now (Message Tasks 5.1): an
   *  unblocked relationship whose active head is ready; false, sendMessage
   *  answers not-ready, blocked or no-own-channel */
  canMessage: boolean
}

/** One message in the inbox (Message Tasks 4.5): accepted, not yet taken
 *  over by the application (takeMessages). */
export interface InboxMessageView {
  commitSeq: Dec
  /** the inbox id, the accepted document's digest; takeMessages names it */
  id: string
  /** the contact of the relationship it arrived on; absent once that
   *  relationship departed */
  contactId?: string
  /** the relationship is blocked now (it was not at acceptance): an
   *  application shows nothing of it (6230) */
  blocked: boolean
  mid: string
  text: string
  replyTo?: string
  /** the sender's statement, distinct from receivedAt (4430) */
  sentAt: Millis
  /** t_ref of the acceptance (4410) */
  receivedAt: Millis
  /** min(sentAt, receivedAt), fixed at acceptance: the order of 4430 with mid */
  displayAt: Millis
}

/** One relationship of a contact, as its chain stands. */
export interface RelationshipView {
  id: string
  tuples: number
  chainedFrom: string[]
  /** the relationship's canonical carrier-nonce entry (Identity §7a.3):
   *  N in base64url and its generation, from which an adapter derives this
   *  side's wire identities; absent where none is held. A relationship
   *  chained into this one is listed only in chainedFrom and shows none:
   *  the chain is carried under this N (profile RLTP-VTI-1230) */
  carrierNonce?: { nonce: string, generation: Dec }
  /** the counterpart's delivery hints from the card of the enactment that
   *  opened this relationship (its first contact; Encounter 6080), as
   *  signed, uninterpreted; absent where that card carried none. A card of
   *  a later enactment chained into the relationship changes nothing */
  counterpartDeliveryHints?: string[]
}

/** One group the holder is a member of. */
export interface GroupView {
  commitSeq: Dec
  /** genesis digest */
  id: string
  /** the group's name, as its genesis names it */
  name: string
  /** listed in the blinded group star (5.2b per-group switch) */
  listed: boolean
  vouchThreshold: Dec
  /** the members this holder knows of, by member anchor (its roster);
   *  `self` marks the own one, `contactId` a member it knows as a contact */
  members: Array<{ anchor: string, name?: string, contactId?: string, self: boolean }>
  /** consent pairs held toward an admission (Membership 3.4), by subject */
  pending: Array<{ member: string, name?: string, vouches: number }>
}

/** The holder's own profile (6450). */
export interface ProfileView { commitSeq: Dec, revision: Dec, name?: string, image?: string, text?: string }

/** One open decision of the human. */
export interface PromptView {
  commitSeq: Dec
  id: string
  kind: PromptKind
  contactId?: string
  groupId?: string
  openedAt: Millis
  expiresAt?: Millis
}

/** One issued document's sender status (Delivery §6.1). */
export interface DeliveryItemView {
  digest: string
  type: string
  threadId: string
  contactId: string
  /** the trias position */
  status: OutboxStatus
  /** the adapter holds the item before the trias (last step awaiting-transport) */
  awaiting?: PreTransportReason
  /** for delivered: after a failure (the holder's own give-up included) */
  late?: boolean
  /** for accepted: the counterpart answered with a next step — arrived,
   *  open at the recipient; no horizon ends it (Delivery RLTP-DEL-6140) */
  held?: true
  /** for failed; task-expired: the sender lifetime its type declares ran out (Delivery 6110) */
  reason?: DeliveryFailure | 'task-expired'
  code?: ReceiverRefusalCode
  attempt: number
  submittedAt: Millis
  updatedAt: Millis
  nextAttemptAt?: Millis
}

export interface DeliveryStatusView { commitSeq: Dec, items: DeliveryItemView[] }

// ── helpers ────────────────────────────────────────────────────────────

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const cmpDec = (a: Dec, b: Dec): number => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0 }
const isObj = (x: unknown): x is Record<string, Json> => x !== null && typeof x === 'object' && !Array.isArray(x)

/** The string fields of a profile body that a view shows. */
const profileFields = (body: Json | null): { name?: string, image?: string, text?: string } => {
  const out: { name?: string, image?: string, text?: string } = {}
  if (!isObj(body)) return out
  for (const k of ['name', 'image', 'text'] as const) if (typeof body[k] === 'string') out[k] = body[k] as string
  return out
}

/** own pair label → its enactment record (encounter.records) */
type RecordIndex = Map<string, EnactmentRecord>

const recordIndex = (state: Readonly<HolderState>): RecordIndex => {
  const ix: RecordIndex = new Map()
  for (const r of Object.values(state.encounter.records)) ix.set(r.label, r)
  return ix
}

/** entry id → the relationships holding a tuple of that entry (2145) */
type EntryIndex = Map<string, Set<string>>

const entryIndex = (state: Readonly<HolderState>): EntryIndex => {
  const ix: EntryIndex = new Map()
  for (const r of Object.values(state.relationships)) {
    for (const t of r.tuples) {
      let s = ix.get(t.entryId)
      if (!s) ix.set(t.entryId, (s = new Set()))
      s.add(r.id)
    }
  }
  return ix
}

/** The contact's own relationships, then those holding a tuple of its entry. */
const relationshipsOf = (state: Readonly<HolderState>, c: Readonly<Contact>, ids: ReadonlySet<string>, ix: EntryIndex): { own: Relationship[], all: Relationship[] } => {
  const own = c.relIds.filter((id) => Object.hasOwn(state.relationships, id)).map((id) => state.relationships[id])
  if (!own.length) throw new Error(`views: contact ${c.id} has no relationship`)
  const seen = new Set(own.map((r) => r.id))
  const all = [...own]
  for (const id of ids) {
    for (const rid of ix.get(id) ?? []) {
      if (!seen.has(rid)) { seen.add(rid); all.push(state.relationships[rid]) }
    }
  }
  return { own, all }
}

/** The counterparty card's delivery hints on the record that opened
 *  relationship `r`: the record of its first tuple's label (a chaining
 *  appends, so the first tuple stays the one the relationship opened with),
 *  found in the per-read label index. */
const firstHints = (r: Readonly<Relationship>, rix: RecordIndex): string[] | undefined => {
  const first = r.tuples[0]
  const rec = first ? rix.get(first.ownPairLabel) : undefined
  if (!rec || rec.relId !== r.id) return undefined
  const h = (rec.card as { deliveryHints?: unknown } | undefined)?.deliveryHints
  return Array.isArray(h) && h.length ? h.filter((x): x is string => typeof x === 'string') : undefined
}

const relationshipView = (state: Readonly<HolderState>, r: Readonly<Relationship>, rix: RecordIndex): RelationshipView => {
  const n = canonicalCarrierNonce(state.register, r.id)
  const hints = firstHints(r, rix)
  return {
    id: r.id, tuples: r.tuples.length,
    chainedFrom: Object.values(state.relationships).filter((x) => x.chainedInto === r.id).map((x) => x.id).sort(cmp),
    ...(n ? { carrierNonce: { nonce: n.nonce, generation: n.generation } } : {}),
    ...(hints ? { counterpartDeliveryHints: hints } : {}),
  }
}

const project = (state: Readonly<HolderState>, c: Readonly<Contact>, ix: EntryIndex, rix: RecordIndex): ContactView => {
  const ids = new Set([c.id, ...c.aliases])
  const { own, all: rels } = relationshipsOf(state, c, ids, ix)
  const mine = (t: Tuple): boolean => ids.has(t.entryId)
  const tuples = rels.flatMap((r) => r.tuples.filter(mine))
  const origin = [...own].sort((a, b) => (a.provenance.at - b.provenance.at) || cmp(a.id, b.id))[0]
  const records = tuples.map((t) => rix.get(t.ownPairLabel)).filter((r): r is EnactmentRecord => r !== undefined)
  const out = records.length ? records.some((r) => r.out !== null) : tuples.some((t) => t.mappingOut.body !== null)
  const inn = records.length ? records.some((r) => r.in !== null) : tuples.some((t) => t.mappingIn.body !== null)
  const newest = [...records].sort((a, b) => b.at - a.at)[0]
  const introduced = own.map((r) => r.memory.introducedName).find((n): n is string => typeof n === 'string')
  const cardName = typeof (newest?.card as { name?: unknown } | undefined)?.name === 'string' ? (newest.card as { name: string }).name : introduced
  const trusted = isTrusted(c)
  const classes = {} as Record<TrustClass, ClassView>
  for (const cls of CLASSES) classes[cls] = { setting: c.settings[cls], on: classOn(cls, c.settings[cls], trusted) }
  const groups: Record<string, ClassView> = {}
  for (const g of [...new Set([...Object.keys(state.groups), ...Object.keys(c.groupSettings)])].sort(cmp)) {
    groups[g] = { setting: Object.hasOwn(c.groupSettings, g) ? c.groupSettings[g] : 'default', on: sealedOn(c, g) }
  }
  const heads: Array<{ r: Relationship, t: Tuple, lagging: boolean }> = []
  for (const r of rels) {
    if (r.chainedInto !== null) continue
    const t = activeTuple(r)
    if (t && !t.deactivated && mine(t)) heads.push({ r, t, lagging: lags(r, rels) })
  }
  // a class-on or re-issue of the anchor mapping, at a version this library
  // handles (classOfDuty: an unhandled version is opaque and owes nothing here)
  const owed = Object.values(state.duties).some((d) =>
    classOfDuty(d) === 'anchorMapping' && (d as { contactId?: unknown }).contactId === c.id)
  const pending = trusted && (owed || heads.some((h) => h.t.mappingOut.body === null || h.lagging))
  let best: Tuple | undefined
  for (const { t, lagging } of heads) {
    if (lagging || t.profileIn.body === null) continue
    if (!best || cmpDec(t.profileIn.rev, best.profileIn.rev) > 0 ||
      (cmpDec(t.profileIn.rev, best.profileIn.rev) === 0 && cmpDec(t.profileIn.verifiedSeq, best.profileIn.verifiedSeq) > 0)) best = t
  }
  const profile = best ? { revision: best.profileIn.rev, ...profileFields(best.profileIn.body) } : undefined
  const received = heads.map((h) => h.t.groupStarIn.accepted).filter((a) => a !== null)
  const sharedGroups = received.length ? [...new Set(received.flatMap((a) => a.groups))].sort(cmp) : undefined
  return {
    commitSeq: state.commitSeq,
    id: c.id,
    aliases: [...c.aliases],
    relationships: own.map((r) => relationshipView(state, r, rix)),
    ...(profile?.name !== undefined ? { displayName: profile.name } : cardName !== undefined ? { displayName: cardName } : {}),
    provenance: origin.provenance.kind,
    ...(origin.provenance.kind === 'introduced' && origin.provenance.via !== undefined ? { via: origin.provenance.via } : {}),
    verification: out && inn ? 'mutual' : out ? 'outgoing' : inn ? 'incoming' : 'met',
    trust: {
      given: trusted,
      received: tuples.some((t) => t.mappingIn.body !== null),
      paused: c.settings.star === 'off' && c.settings.groupStar === 'off',
      pending,
    },
    classes: { ...classes, sealedGroupStar: { ...classes.sealedGroupStar, groups } } as ClassesView,
    ...(sharedGroups ? { sharedGroups } : {}),
    ...(profile ? { profile } : {}),
    blocked: own.some((r) => state.messages.blocked.includes(r.id)),
    canMessage: !('ok' in messageChannel(state, c.id)),
  }
}

const itemView = (digest: string, it: Readonly<OutboxItem>): DeliveryItemView => {
  const status = triasOf(it)
  const last = it.history[it.history.length - 1]
  let decisive: OutboxItem['history'][number] | undefined
  for (let i = it.history.length - 1; i >= 0 && !decisive; i--) if (it.history[i].status !== 'awaiting-transport') decisive = it.history[i]
  const v: DeliveryItemView = {
    digest, type: it.type, threadId: it.threadId, contactId: it.recipient.contactId, status,
    attempt: it.attempt, submittedAt: it.history[0]?.at ?? 0, updatedAt: last?.at ?? 0,
  }
  if (last?.status === 'awaiting-transport') v.awaiting = last.reason
  if (decisive?.status === 'delivered') v.late = decisive.late
  if (status === 'accepted' && heldOf(it)) v.held = true
  if (decisive?.status === 'failed') {
    v.reason = decisive.reason
    if (decisive.reason === 'rejected-by-receiver') v.code = decisive.code
  }
  if (it.nextAttemptAt !== undefined) v.nextAttemptAt = it.nextAttemptAt
  return v
}

// ── the views ──────────────────────────────────────────────────────────

/** Every contact, in entry-commit order (2120), then by id. */
export function contactsView (state: Readonly<HolderState>): ContactView[] {
  const order = Object.values(state.contacts).sort((a, b) => {
    if (a.pos !== null && b.pos !== null) return cmpDec(a.pos, b.pos) || cmp(a.id, b.id)
    if (a.pos !== null) return -1
    if (b.pos !== null) return 1
    return cmp(a.id, b.id)
  })
  const ix = entryIndex(state)
  const rix = recordIndex(state)
  return freezeDeep(order.map((c) => project(state, c, ix, rix)))
}

/** One contact by entry id or alias; undefined if there is none. */
export function contactView (state: Readonly<HolderState>, id: string): ContactView | undefined {
  const c = findContact(state, id)
  return c ? freezeDeep(project(state, c, entryIndex(state), recordIndex(state))) : undefined
}

/** The holder's groups, by genesis digest. */
export function groupsView (state: Readonly<HolderState>): GroupView[] {
  return freezeDeep(Object.values(state.groups).sort((a, b) => cmp(a.id, b.id)).map((g) => ({
    commitSeq: state.commitSeq, id: g.id, name: g.name, listed: g.listed, vouchThreshold: g.rules.vouchThreshold,
    members: Object.values(g.roster).sort((a, b) => cmp(a.anchor, b.anchor)).map((m) => ({
      anchor: m.anchor, ...(m.name !== undefined ? { name: m.name } : {}), ...(m.contactId !== undefined ? { contactId: m.contactId } : {}), self: m.anchor === g.memberAnchor,
    })),
    pending: Object.values(g.evidence).map((e) => {
      const acc = (e.accept as { payload?: { accept?: { subject?: string, card?: { name?: string } } } }).payload?.accept
      return { member: acc?.subject ?? '', ...(typeof acc?.card?.name === 'string' ? { name: acc.card.name } : {}), vouches: e.vouches.length }
    }).sort((a, b) => cmp(a.member, b.member)),
  })))
}

/** The holder's own profile. */
export function profileView (state: Readonly<HolderState>): ProfileView {
  return freezeDeep({ commitSeq: state.commitSeq, revision: state.profile.revision, ...profileFields(state.profile.body) })
}

/** The open prompts, by opening time, then id. Expired prompts stay
 *  listed until tick removes them; deciding one is refused. */
export function promptsView (state: Readonly<HolderState>): PromptView[] {
  return freezeDeep(Object.values(state.prompts).sort((a, b) => (a.openedAt - b.openedAt) || cmp(a.id, b.id)).map((p) => ({
    commitSeq: state.commitSeq, id: p.id, kind: p.kind,
    ...(p.contactId !== undefined ? { contactId: p.contactId } : {}),
    ...(p.groupId !== undefined ? { groupId: p.groupId } : {}),
    openedAt: p.openedAt,
    ...(p.expiresAt !== undefined ? { expiresAt: p.expiresAt } : {}),
  })))
}

/** The sender status of the documents whose digest or threadId is `x`. */
export function deliveryStatusView (state: Readonly<HolderState>, x: string): DeliveryStatusView {
  const items = Object.entries(state.outbox)
    .filter(([digest, it]) => digest === x || it.threadId === x)
    .map(([digest, it]) => itemView(digest, it))
    .sort((a, b) => (a.submittedAt - b.submittedAt) || cmp(a.digest, b.digest))
  return freezeDeep({ commitSeq: state.commitSeq, items })
}

/** The inbox (Message Tasks 4.5), ordered by display time, then mid (4430). */
export function inboxView (state: Readonly<HolderState>): InboxMessageView[] {
  const out = Object.values(state.messages.inbox).map((e) => {
    const t = tupleByLabel(state, e.tuple)
    const c = t ? (findContact(state, t.tuple.entryId) ?? findContact(state, t.rel.contactId)) : undefined
    const b = e.body as { text: string, replyTo?: string, sentAt: string }
    return {
      commitSeq: state.commitSeq, id: e.id, ...(c ? { contactId: c.id } : {}),
      blocked: t !== null && state.messages.blocked.includes(t.rel.id),
      mid: e.mid, text: b.text, ...(b.replyTo !== undefined ? { replyTo: b.replyTo } : {}),
      sentAt: Date.parse(b.sentAt), receivedAt: e.receivedAt, displayAt: e.displayAt,
    }
  }).sort((a, b) => (a.displayAt - b.displayAt) || cmp(a.mid, b.mid) || cmp(a.id, b.id))
  return freezeDeep(out)
}
