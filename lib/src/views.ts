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
//   - verification is over all of the entry's tuples, deactivated and
//     older ones included (historical evidence): `outgoing` an anchor
//     mapping was issued (mappingOut), `incoming` one was verified
//     (mappingIn), `mutual` both, `met` neither
//   - trust.given is the anchor mapping class on (the Trust act, 2770);
//     trust.received a verified anchor mapping from the contact, whose
//     class has no default recipient (2760); trust.paused the pause of 5.4,
//     star and blinded group star both `off` (2780); trust.pending: given,
//     but not yet out on every head (no mapping issued on it, or its
//     relationship lags (6595)), or a re-issue or class-on duty for the
//     anchor mapping is open. Delivery of the documents is not part of
//     it; deliveryStatus answers that
//   - classes give the setting and whether the class is on toward the
//     contact (2760, 2840); per-group settings of the sealed group star
//     (2830) are not projected yet
//   - a contact's profile (6425): among the verified profile@1 bodies
//     (6b.2) on its heads whose relationship does not lag (6461, 6595),
//     the highest revision, among equal ones the one verified last
//     (highest verifiedSeq); displayName is that profile's name
//   - deliveryStatus(x) lists the outbox items whose digest or threadId is
//     x, by first submission, then digest; an unknown x lists none
//   - a contact without a relationship breaks an invariant and throws
import { freezeDeep } from './util-freeze.js'
import type { Json } from './core.js'
import { triasOf } from './state.js'
import { CLASSES, activeTuple, classOn, findContact, lags, trusted as isTrusted } from './trust/state.js'
import type {
  Contact, Dec, HolderState, Millis, OutboxItem, OutboxStatus, PromptKind, Relationship, Setting, TrustClass, Tuple,
} from './state.js'
import type { DeliveryFailure, PreTransportReason, ReceiverRefusalCode } from './ports.js'

/** One trust class toward one contact: its setting (2810) and whether it is on (2760). */
export interface ClassView { setting: Setting, on: boolean }

/** A contact's verified profile (6b.2): string fields only. */
export interface ContactProfileView { revision: Dec, name?: string, image?: string, text?: string }

/** One contact, i.e. one entry of the deliverable set (2120, 2140). */
export interface ContactView {
  /** the commitSeq of the state this view was read from */
  commitSeq: Dec
  /** the entry id: stable across aliases (2140) and chains (6a.4) */
  id: string
  /** identities merged into this entry; contact(alias) finds it too */
  aliases: string[]
  /** the verified profile's name. Before profile@1 graduates (PR 6) no
   *  profile is verified, and the ceremony card's name enters the state
   *  only when Encounter graduates (PR 7); until then mostly undefined. */
  displayName?: string
  provenance: 'ceremony' | 'introduced'
  /** the introducer, for an introduced contact */
  via?: string
  verification: 'mutual' | 'outgoing' | 'incoming' | 'met'
  trust: { given: boolean, received: boolean, paused: boolean, pending: boolean }
  classes: Record<TrustClass, ClassView>
  /** groups shared with the contact. Not derivable yet: it needs the
   *  group star's reception (5.2b) in the state, which PR 4 brings;
   *  until then always undefined, never a claimed empty list. */
  sharedGroups?: string[]
  profile?: ContactProfileView
}

/** One group the holder is a member of. */
export interface GroupView {
  commitSeq: Dec
  /** genesis digest */
  id: string
  /** listed in the blinded group star (5.2b per-group switch) */
  listed: boolean
  vouchThreshold: Dec
  /** the group's name and members arrive with membership's graduation (PR 7) */
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
  /** for failed */
  reason?: DeliveryFailure
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

const project = (state: Readonly<HolderState>, c: Readonly<Contact>, ix: EntryIndex): ContactView => {
  const ids = new Set([c.id, ...c.aliases])
  const { own, all: rels } = relationshipsOf(state, c, ids, ix)
  const mine = (t: Tuple): boolean => ids.has(t.entryId)
  const tuples = rels.flatMap((r) => r.tuples.filter(mine))
  const origin = [...own].sort((a, b) => (a.provenance.at - b.provenance.at) || cmp(a.id, b.id))[0]
  const out = tuples.some((t) => t.mappingOut.body !== null)
  const inn = tuples.some((t) => t.mappingIn.body !== null)
  const trusted = isTrusted(c)
  const classes = {} as Record<TrustClass, ClassView>
  for (const cls of CLASSES) classes[cls] = { setting: c.settings[cls], on: classOn(cls, c.settings[cls], trusted) }
  const heads: Array<{ r: Relationship, t: Tuple, lagging: boolean }> = []
  for (const r of rels) {
    if (r.chainedInto !== null) continue
    const t = activeTuple(r)
    if (t && !t.deactivated && mine(t)) heads.push({ r, t, lagging: lags(r, rels) })
  }
  const owed = Object.values(state.duties).some((d) =>
    (d.kind === 'reissue-mapping' && d.contactId === c.id) ||
    (d.kind === 'class-on' && d.contactId === c.id && d.cls === 'anchorMapping'))
  const pending = trusted && (owed || heads.some((h) => h.t.mappingOut.body === null || h.lagging))
  let best: Tuple | undefined
  for (const { t, lagging } of heads) {
    if (lagging || t.profileIn.body === null) continue
    if (!best || cmpDec(t.profileIn.rev, best.profileIn.rev) > 0 ||
      (cmpDec(t.profileIn.rev, best.profileIn.rev) === 0 && cmpDec(t.profileIn.verifiedSeq, best.profileIn.verifiedSeq) > 0)) best = t
  }
  const profile = best ? { revision: best.profileIn.rev, ...profileFields(best.profileIn.body) } : undefined
  return {
    commitSeq: state.commitSeq,
    id: c.id,
    aliases: [...c.aliases],
    ...(profile?.name !== undefined ? { displayName: profile.name } : {}),
    provenance: origin.provenance.kind,
    ...(origin.provenance.kind === 'introduced' && origin.provenance.via !== undefined ? { via: origin.provenance.via } : {}),
    verification: out && inn ? 'mutual' : out ? 'outgoing' : inn ? 'incoming' : 'met',
    trust: {
      given: trusted,
      received: inn,
      paused: c.settings.star === 'off' && c.settings.groupStar === 'off',
      pending,
    },
    classes,
    ...(profile ? { profile } : {}),
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
  return freezeDeep(order.map((c) => project(state, c, ix)))
}

/** One contact by entry id or alias; undefined if there is none. */
export function contactView (state: Readonly<HolderState>, id: string): ContactView | undefined {
  const c = findContact(state, id)
  return c ? freezeDeep(project(state, c, entryIndex(state))) : undefined
}

/** The holder's groups, by genesis digest. */
export function groupsView (state: Readonly<HolderState>): GroupView[] {
  return freezeDeep(Object.values(state.groups).sort((a, b) => cmp(a.id, b.id)).map((g) => ({
    commitSeq: state.commitSeq, id: g.id, listed: g.listed, vouchThreshold: g.rules.vouchThreshold,
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
