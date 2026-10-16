// trust/entries — the entries of the deliverable set on the holder (lib
// Stage 2, PR 4c; Trust Section 2, 6a.1): merge, split, departure, the
// pending admission that goes with them, and the identity rewrite they
// need, on HolderState.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// What it registers (through trustModule, trust/mapping.ts):
//   commands  trust.merge {contactIds}               the manual merge of
//               rung 3 (6640): at most one of them holds an entry; human
//             trust.depart {contactId, relationshipId?}   departure (2260):
//               the entry id departs the whole entry, an alias the
//               relationship(s) whose identity it is, a relationshipId that
//               one relationship; human
//   duty      merge/1 (2230): the persisted continuation of a merge the
//             net (rung 2) or a chaining (2145) made admissible; it runs
//             after the verification commit, as one atomic step
//
// The model. An entry is a Contact; its id is the identity of one of its
// relationships (2100, 2140). A relationship's own identity is its
// contactId, the contact id it was created under, which stays its identity
// when it is merged (then an alias of the entry) and which it takes along
// when it leaves (2090, 2100). A fresh relationship whose tuple a chaining
// appended to a chain stays as a husk (no tuples, chainedInto = the
// chain): its contactId is a chain alias of the chain (2090).
//
// Choices this file makes where note and spec leave them open:
//   - every merge path but the manual act runs as a merge/1 duty: the
//     verification (or the chaining) commits first, and the duty, run by
//     the next resume before the sweeps, merges in one step (2230). The
//     duty persists its witness (each entry's anchor head and the heads
//     each held as superseded) and runs only while it holds and the binding
//     rule and the one anchor head (6605, 6560) still hold; otherwise it is
//     dropped silently. A verification that admits the merge of the same
//     entries while a duty is open refreshes its witness. The manual merge
//     (6640) involves no verification and merges in its own act
//   - the merged entry's identity: the entry at the earliest position
//     (2140); where none holds one, the identity of the relationship whose
//     active head was created last (2180, entryOrder.heads)
//   - the net (rung 2) runs on every accepted anchor mapping: the incoming
//     relationship against every other entry when it does not lag in its
//     own entry (6550), and, where the entry's
//     anchor head changed, every relationship of another entry against it
//     (6580); all entries that join in one evaluation merge in one duty
//     (2150), taken in position order while they stay mergeable together
//   - the split (2080) applies to the first verified mapping on a
//     relationship of an entry whose other relationships hold an anchor:
//     a relationship without a mapping can share an entry with others only
//     by the manual merge (6640); see the split exception below
//   - "oldest remaining relationship in entry-commit order" (2100): by
//     firstVerified (the commitSeq of its first verification, 2190), never
//     verified ones after, then by the creation of their active heads
//   - departure removes the relationship (and its husks) from the state;
//     its tuples' address keys become tombstones by tick's retention. Its
//     open duties go; its outbox items run to their horizon. An entry
//     removed with it leaves the matches of every accepted star (6160); an
//     entry that keeps relationships keeps its matches, though the anchors
//     behind one may have left with the relationship (a match is not
//     re-tested without the star's key; matches only grow otherwise)
//   - a merge rewrites every holder-local key of the merged ids to the
//     survivor's; a rename (2100) rewrites the remaining entry's keys and
//     the star baselines' members, so a rename alone diverges nothing; the
//     introducer a relationship names (provenance.via) follows both; the
//     stored acks follow through the engine (Applied.renames)
//   - a split (2080) moves a contact reference with the relationship it
//     was made on, never with the entry it was filed under: membership
//     records keep the own rkid of the tuple their prelude went or arrived
//     on (joining preludes and invites, groups' preludes and invitations,
//     the roster entry an invitation became), introduction records the own
//     pair label toward the mediator (an offer's pin, the introducer's
//     provenance.viaPin, the voucher mark's memory.vouchedPin); a prompt
//     follows the record it asks about
//   - head rule (b) for the incoming relationship is read by the rationale
//     under 6590 ("only knowledge the committed mapping newly carries
//     connects … stale knowledge … must not create a merge"): (b) is
//     evaluated against the links its entry held before this
//     verification's lineage joined them (6610), while that lineage counts
//     for (a). Read literally after the commit, 6540 would refuse every
//     case 6530 (a) admits by a lineage that extends E's head; the wording
//     of 6540 is a follow-up for Trust 0.32
//   - the split exception: 2080 read literally would split every manual
//     merge of unmapped relationships at the first mapping; open point for
//     Trust 0.32. A relationship whose entry's other relationships hold no
//     anchor yet stays
//
// Open point for Trust 0.32: 6540/6580/6590 in the rotation direction;
// today's behaviour is pinned, not justified normatively. The incoming
// relationship is joined against the links its entry held before the
// verification (the 6590 rationale, mergeDutiesAfter), the 6580 direction
// (an entry's anchor head changed) against the other entry's current
// links; so a relationship rotating up to a head another entry's lineage
// extends opens no merge, while the same relationships arriving the other
// way round can (test/trust-ported.test.mjs, "the other direction").
import type { CommandDef, DutyHandler, EventDraft, IdentityRename, Refusal, Applied } from '../engine.js'
import type { ClassOnDuty, Contact, Dec, Duty, HolderState, MergeDuty, Prompt, ReissueMappingDuty, Relationship, Setting, StarPair, TrustClass, Tuple } from '../state.js'
import {
  CLASSES, anchorSet, classOnToward, conflicts, entryOf, entryRelationships, feeding, findContact, joins, lags, liveRel, newestHeads, newestOf, supersededIn,
} from './state.js'
import { viewDigest } from './star.js'
import { dropOff, followClasses } from './duties.js'
import { isKnownDuty } from '../codec.js'
import { jcs } from '../core.js'
const jcsEq = (a: unknown, b: unknown): boolean => jcs(a) === jcs(b)

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const cmpDec = (a: Dec, b: Dec): number => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0 }
const byPos = (a: Readonly<Contact>, b: Readonly<Contact>): number => cmpDec(a.pos!, b.pos!) || cmp(a.id, b.id)
const unique = <T>(xs: Iterable<T>): T[] => [...new Set(xs)]

/** The trust module's entry commands. */
export const ENTRY_COMMANDS = Object.freeze({ merge: 'trust.merge', depart: 'trust.depart' } as const)

export interface TrustMergeInput { contactIds: string[] }
export interface TrustDepartInput { contactId: string, relationshipId?: string }

// ── the anchor head and admission ──────────────────────────────────────

/**
 * The entry's anchor head from what its relationships hold (6560): the
 * newest of the heads its feeding relationships hold; among several
 * (a manual merge before its split) the one it holds, else `prefer`, else
 * the smallest. Where a relationship of it feeds another entry (2145), the
 * head only moves forward: with no feeding head, or none beyond it, it
 * stays. With neither, the entry has none.
 */
export function settleHead (state: Readonly<HolderState>, c: Readonly<Contact>, prefer: string | null = null): Contact {
  const rels = feeding(state, c)
  const all = entryRelationships(state, c)
  const newest = newestHeads(rels)
  if (!newest.length) {
    if (all.length > rels.length) return c as Contact
    return c.anchorHead === null ? c as Contact : { ...c, anchorHead: null }
  }
  // 2145: a chain of this entry feeds the other one; what the rest feeds
  // never moves the head back — it stays unless a feeding head lies
  // beyond it along the links the entry's relationships hold
  if (all.length > rels.length && c.anchorHead !== null && newestOf([...newest, c.anchorHead], all.flatMap((r) => r.links)).includes(c.anchorHead)) return c as Contact
  const head = newest.length === 1 ? newest[0]
    : c.anchorHead !== null && newest.includes(c.anchorHead) ? c.anchorHead
      : prefer !== null && newest.includes(prefer) ? prefer
        : [...newest].sort(cmp)[0]
  return head === c.anchorHead ? c as Contact : { ...c, anchorHead: head }
}

/** 2250: pending entries join the set in position order while it has room. */
export function admitPending (state: Readonly<HolderState>, bound: bigint): HolderState {
  let admitted = BigInt(Object.values(state.contacts).filter((x) => x.status === 'admitted').length)
  const pending = Object.values(state.contacts).filter((x) => x.status === 'pending' && x.pos !== null).sort(byPos)
  let contacts: HolderState['contacts'] | null = null
  for (const c of pending) {
    if (admitted >= bound) break
    contacts ??= { ...state.contacts }
    contacts[c.id] = { ...c, status: 'admitted' }
    admitted += 1n
  }
  return contacts ? { ...state, contacts } : state as HolderState
}

// ── the identity rewrite (2100, 2140) ──────────────────────────────────

interface RewriteOpts {
  /** the relationships whose keys move: their tuples' entryId, their
   *  duties, the recipients of their documents; default all */
  rels?: (relId: string) => boolean
  /** also the keys that name the person rather than a relationship: the
   *  matches of accepted stars, prompts, the entry ids of merge duties */
  global?: boolean
  /** also the members of the star baselines and in-flight views (a
   *  rename: nothing diverges by it) */
  baselines?: boolean
  /** collects the rename for the engine, which follows it in the stored
   *  acks (engine.ts Applied.renames) */
  renames?: IdentityRename[]
}

/** Rename members of one star scope's views, re-sorted and re-digested. */
function renameView (view: StarPair[], from: (id: string) => boolean, to: string): StarPair[] | null {
  if (!view.some((p) => from(p.member))) return null
  return view.map((p) => (from(p.member) ? { ...p, member: to } : p)).sort((a, b) => cmp(a.member, b.member))
}

function renameBaselines (t: Tuple, from: (id: string) => boolean, to: string): Tuple {
  const o = t.starOut
  let changed = false
  let snapshot = o.snapshot
  let snapshotDigest = o.snapshotDigest
  if (snapshot) {
    const v = renameView(snapshot, from, to)
    if (v) { snapshot = v; snapshotDigest = viewDigest(v); changed = true }
  }
  const inflight: typeof o.inflight = {}
  for (const [salt, f] of Object.entries(o.inflight)) {
    const v = renameView(f.view, from, to)
    if (v) { inflight[salt] = { ...f, view: v, viewDigest: viewDigest(v) }; changed = true } else inflight[salt] = f
  }
  return changed ? { ...t, starOut: { ...o, snapshot, snapshotDigest, inflight } } : t
}

/** The tuple the record a prompt asks about was made on: a group-invite's
 *  invite by its own rkid, an introduction's offer or the target's act by
 *  its pin toward the mediator; null where none is held (an
 *  encounter-confirm names the fresh relationship's own identity). */
function promptTuple (state: Readonly<HolderState>, p: Readonly<Prompt>): { rkid: string } | { label: string } | null {
  if (p.kind === 'group-invite') {
    const i = Object.values(state.joining.invites).find((x) => x.promptId === p.id)
    return i ? { rkid: i.rkid } : null
  }
  if (p.kind === 'introduction') {
    if (Object.hasOwn(state.encounter.offers, p.id)) return { label: state.encounter.offers[p.id].pin }
    const a = Object.values(state.encounter.introductions).find((x) => x.role === 'target' && x.promptId === p.id)
    return a?.pins.mediator !== undefined ? { label: a.pins.mediator } : null
  }
  return null
}

/**
 * Every holder-local key that resolved through an identity in `ids` now
 * resolves through `to` (2100, 2140), within `opts`: tuples' entryId,
 * duties, the recipients of issued documents, and with `global` the
 * matches of accepted stars and merge duties; and the contact references
 * of the membership and introduction state and of prompts, each with the
 * relationship of the tuple it was made on (2080): by the own rkid it
 * arrived or went on (joining preludes and invites, groups' preludes,
 * invitations and roster) or the own pair label toward the mediator
 * (encounter.offers by their pin, the introducer provenance.via by
 * viaPin, memory.vouchedBy by memory.vouchedPin), a prompt with the
 * record it asks about; one that names no tuple follows with `global`.
 * Contacts are the caller's: their ids
 * and aliases are what the rewrite follows. The stored acks follow
 * through the engine (opts.renames): only the core writes the effect
 * cache, and their sealed envelopes stay as they are. Parts without a
 * change keep their identity.
 */
export function rewriteIdentity (state: Readonly<HolderState>, ids: readonly string[], to: string, opts: RewriteOpts = {}): HolderState {
  const from = (x: string): boolean => ids.includes(x)
  const inRel = opts.rels ?? (() => true)
  // the own rkids and pair labels of the tuples within `opts`
  const rkids = new Set<string>(), labels = new Set<string>()
  for (const [id, r] of Object.entries(state.relationships)) {
    if (inRel(id)) for (const t of r.tuples) { rkids.add(t.rkid); labels.add(t.ownPairLabel) }
  }
  const byRkid = (rkid: string | undefined): boolean => (rkid === undefined ? !!opts.global : !opts.rels || rkids.has(rkid))
  const byLabel = (label: unknown): boolean => (typeof label !== 'string' ? !!opts.global : !opts.rels || labels.has(label))
  const re = (x: string | undefined, tied: boolean): boolean => x !== undefined && from(x) && tied
  let relationships: HolderState['relationships'] | null = null
  for (const [id, r] of Object.entries(state.relationships)) {
    const mine = inRel(id)
    let changed = false
    const tuples = r.tuples.map((t) => {
      let x = t
      if (mine && from(t.entryId)) x = { ...x, entryId: to }
      const acc = x.starIn.accepted
      if (opts.global && acc && acc.matches.some(from)) {
        x = { ...x, starIn: { ...x.starIn, accepted: { ...acc, matches: unique(acc.matches.map((m) => (from(m) ? to : m))).sort(cmp) } } }
      }
      if (opts.baselines) x = renameBaselines(x, from, to)
      if (x !== t) changed = true
      return x
    })
    // the introducer with the relationship toward it the act was pinned to
    const provenance = re(r.provenance.via, byLabel(r.provenance.viaPin)) ? { ...r.provenance, via: to } : r.provenance
    if (changed || provenance !== r.provenance) (relationships ??= { ...state.relationships })[id] = { ...r, tuples, provenance }
  }
  opts.renames?.push({ from: [...ids], to, rkids: opts.rels ? [...rkids].sort() : null })
  let duties: HolderState['duties'] | null = null
  for (const [id, d] of Object.entries(state.duties)) {
    if (!isKnownDuty(d)) continue   // a kind or version this library does not handle stays as it is
    const x = d as unknown as Record<string, unknown>
    let nd: Duty = d
    if (d.kind === 'merge' && opts.global && Array.isArray(x.entryIds) && (x.entryIds as string[]).some(from)) {
      nd = { ...d, entryIds: unique((x.entryIds as string[]).map((e) => (from(e) ? to : e))).sort(cmp) } as Duty
    } else if (d.kind !== 'merge' && typeof x.contactId === 'string' && from(x.contactId) && (typeof x.relId !== 'string' || inRel(x.relId))) {
      nd = { ...d, contactId: to } as Duty
    }
    if (nd !== d) (duties ??= { ...state.duties })[id] = nd
  }
  // membership, introduction and prompts: each contact reference with the
  // relationship of the tuple it was made on, where it names one (2080)
  let prompts: HolderState['prompts'] | null = null
  for (const [id, p] of Object.entries(state.prompts)) {
    const at = promptTuple(state, p)
    const tied = at === null ? !!opts.global : 'rkid' in at ? byRkid(at.rkid) : byLabel(at.label)
    if (re(p.contactId, tied)) (prompts ??= { ...state.prompts })[id] = { ...p, contactId: to }
  }
  let joining: HolderState['joining'] | null = null
  for (const [k, p] of Object.entries(state.joining.preludes)) {
    if (re(p.contactId, byRkid(p.rkid))) (joining ??= { ...state.joining, preludes: { ...state.joining.preludes } }).preludes[k] = { ...p, contactId: to }
  }
  for (const [k, i] of Object.entries(state.joining.invites)) {
    if (re(i.contactId, byRkid(i.rkid))) {
      joining ??= { ...state.joining, preludes: { ...state.joining.preludes } }
      joining.invites = { ...joining.invites, [k]: { ...i, contactId: to } }
    }
  }
  let groups: HolderState['groups'] | null = null
  for (const [gid, g] of Object.entries(state.groups)) {
    const preludes = Object.fromEntries(Object.entries(g.preludes).map(([k, p]) => [k, re(p.contactId, byRkid(p.rkid)) ? { ...p, contactId: to } : p]))
    const invitations = Object.fromEntries(Object.entries(g.invitations).map(([k, i]) => [k, re(i.contactId, byRkid(i.rkid)) ? { ...i, contactId: to } : i]))
    const roster = Object.fromEntries(Object.entries(g.roster).map(([k, m]) => [k, re(m.contactId, byRkid(m.rkid)) ? { ...m, contactId: to } : m]))
    if (jcsEq(preludes, g.preludes) && jcsEq(invitations, g.invitations) && jcsEq(roster, g.roster)) continue
    ;(groups ??= { ...state.groups })[gid] = { ...g, preludes, invitations, roster }
  }
  let encounter: HolderState['encounter'] | null = null
  for (const [k, o] of Object.entries(state.encounter.offers)) {
    if (re(o.mediatorContactId, byLabel(o.pin))) (encounter ??= { ...state.encounter, offers: { ...state.encounter.offers } }).offers[k] = { ...o, mediatorContactId: to }
  }
  // the voucher mark names the mediator that vouched: it follows the
  // relationship toward that mediator the voucher came on (memory.vouchedPin),
  // not the entry it was filed under
  for (const [id, r] of Object.entries(relationships ?? state.relationships)) {
    const v = r.memory.vouchedBy
    if (typeof v === 'string' && re(v, byLabel(r.memory.vouchedPin))) (relationships ??= { ...state.relationships })[id] = { ...r, memory: { ...r.memory, vouchedBy: to } }
  }
  let outbox: HolderState['outbox'] | null = null
  for (const [d, it] of Object.entries(state.outbox)) {
    if (from(it.recipient.contactId) && rkids.has(it.recipient.rkid)) (outbox ??= { ...state.outbox })[d] = { ...it, recipient: { ...it.recipient, contactId: to } }
  }
  if (!relationships && !duties && !prompts && !outbox && !joining && !groups && !encounter) return state as HolderState
  return {
    ...state,
    ...(relationships ? { relationships } : {}), ...(duties ? { duties } : {}), ...(prompts ? { prompts } : {}), ...(outbox ? { outbox } : {}),
    ...(joining ? { joining } : {}), ...(groups ? { groups } : {}), ...(encounter ? { encounter } : {}),
  }
}

// ── merge (2140–2180) ──────────────────────────────────────────────────

/** 2160: per class `off` where any held `off`, else `on` where any held
 *  `on`, else `default`; per (group, contact) the same, every per-group
 *  `on` reset where the merged sealed group star is `off` (5450). */
export function mergeSettings (cs: readonly Readonly<Contact>[]): { settings: Record<TrustClass, Setting>, groupSettings: Record<string, Setting> } {
  const pick = (xs: Setting[]): Setting => (xs.includes('off') ? 'off' : xs.includes('on') ? 'on' : 'default')
  const settings = {} as Record<TrustClass, Setting>
  for (const cls of CLASSES) settings[cls] = pick(cs.map((c) => c.settings[cls]))
  const groupSettings: Record<string, Setting> = {}
  for (const g of unique(cs.flatMap((c) => Object.keys(c.groupSettings))).sort(cmp)) {
    const s = pick(cs.map((c) => c.groupSettings[g] ?? 'default'))
    if (s === 'off' || (s === 'on' && settings.sealedGroupStar !== 'off')) groupSettings[g] = s
  }
  return { settings, groupSettings }
}

/**
 * Whether entries can be one (6605, 6560): no relationship of one holds
 * another binding (or another successor) for an anchor a relationship of
 * another holds, and their anchor heads lie on one chain of the links
 * their relationships hold, so the merged entry has exactly one.
 */
export function mergeable (state: Readonly<HolderState>, cs: readonly Readonly<Contact>[]): boolean {
  if (cs.length < 2 || new Set(cs.map((c) => c.id)).size !== cs.length) return false
  const rels = cs.map((c) => entryRelationships(state, c))
  for (let i = 0; i < rels.length; i++) for (let j = i + 1; j < rels.length; j++) if (conflicts(rels[i], rels[j])) return false
  const all = unique(rels.flat())
  const heads = [...cs.map((c) => c.anchorHead), ...all.map((r) => r.heldCounterpartHead)].filter((h): h is string => h !== null)
  return newestOf(heads, all.flatMap((r) => r.links)).length <= 1
}

/** Where the newest active head among the entries' relationships was created (2180). */
function newestRelationship (state: Readonly<HolderState>, cs: readonly Readonly<Contact>[]): Relationship | undefined {
  let best: Relationship | undefined
  let at = -1
  for (const c of cs) {
    for (const r of entryRelationships(state, c)) {
      const i = state.entryOrder.heads.indexOf(r.id)
      if (i > at) { at = i; best = r }
    }
  }
  return best
}

/**
 * The atomic merge of entries (2140, 2150, 2160, 2180): one entry at the
 * earliest position under the survivor's identity, the others its
 * aliases; admitted where any was, so `k` admitted ones free `k−1` slots,
 * which the next pending entries take in position order in the same step;
 * every key of a merged id rewritten to the survivor; the anchor head
 * settled (6560). Per-tuple keys stay with their tuples.
 */
export function mergeEntries (state: Readonly<HolderState>, cs: readonly Readonly<Contact>[], bound: bigint): Applied & { survivor: string } {
  const withPos = cs.filter((c) => c.pos !== null).sort(byPos)
  let survivor: Readonly<Contact>
  let id: string
  if (withPos.length) { survivor = withPos[0]; id = survivor.id } else {
    const r = newestRelationship(state, cs)
    survivor = (r && cs.find((c) => c.relIds.includes(r.id))) ?? cs[0]
    // the relationship's identity, where it names the survivor (2180)
    id = r && findContact(state, r.contactId)?.id === survivor.id ? r.contactId : survivor.id
  }
  return mergeInto(state, survivor, id, cs.filter((c) => c !== survivor), bound)
}

/** The merge onto a chosen survivor under identity `id` (its id or one of its aliases). */
export function mergeInto (state: Readonly<HolderState>, survivor: Readonly<Contact>, id: string, gone: readonly Readonly<Contact>[], bound: bigint): Applied & { survivor: string } {
  const all = [survivor, ...gone]
  const { settings, groupSettings } = mergeSettings(all)
  const status: Contact['status'] = all.some((c) => c.status === 'admitted') ? 'admitted' : all.some((c) => c.status === 'pending') ? 'pending' : 'none'
  const positioned = all.filter((c) => c.pos !== null).sort(byPos)
  const merged = all.map((c) => c.id).filter((x) => x !== id)
  const contacts = { ...state.contacts }
  for (const c of all) delete contacts[c.id]
  contacts[id] = {
    id, pos: positioned[0]?.pos ?? null, status,
    aliases: unique(all.flatMap((c) => [c.id, ...c.aliases])).filter((x) => x !== id).sort(cmp),
    relIds: unique(all.flatMap((c) => c.relIds)),
    anchorHead: survivor.anchorHead ?? positioned.find((c) => c.anchorHead !== null)?.anchorHead ?? null,
    settings, groupSettings,
  }
  const renames: IdentityRename[] = []
  let next: HolderState = rewriteIdentity({ ...state, contacts }, merged, id, { global: true, renames })
  next = { ...next, contacts: { ...next.contacts, [id]: settleHead(next, next.contacts[id]) } }
  // the class duties of the merged settings (2160, 2850, 6410): per
  // relationship against the entry it sent under before (2146)
  const f = followClasses(state, admitPending(next, bound))
  next = f.state
  return {
    state: next, events: [{ type: 'contact.merged', contactId: id, merged: [...merged].sort(cmp) }],
    ...(f.duties.length ? { duties: f.duties } : {}), renames, survivor: id,
  }
}

/**
 * The merge duties a commit on `relId` opens (2230): where the
 * relationship stands behind another entry (2145) that is now mergeable
 * with its own, and, with `net`, the convergence net of rung 2 for an
 * accepted anchor mapping (6520–6605). One duty for every entry that
 * joins, in position order while they stay mergeable together (2150).
 */
export function mergeDutiesAfter (before: Readonly<HolderState>, after: HolderState, relId: string, opts: { net: boolean }): { state: HolderState, duties: MergeDuty[] } {
  const none = { state: after, duties: [] }
  const rel = after.relationships[relId]
  const E = rel && entryOf(after, rel)
  if (!E || E.pos === null || E.anchorHead === null) return none
  const eRels = entryRelationships(after, E)
  const others = Object.values(after.contacts).filter((x) => x.id !== E.id && x.pos !== null && x.anchorHead !== null).sort(byPos)
  const picked: Contact[] = []
  const take = (x: Contact): void => { if (!picked.includes(x) && mergeable(after, [E, ...picked, x])) picked.push(x) }
  // 2145: the other entry behind this relationship, once comparable and the binding rule admits
  for (const t of rel.tuples) {
    const x = findContact(after, t.entryId)
    if (x && x.id !== E.id && x.pos !== null && x.anchorHead !== null) take(x)
  }
  if (opts.net) {
    // the incoming relationship, where it does not lag in its own entry
    // (6550). Head rule (b) against the knowledge the entry held before
    // this commit: its relationships' links with this relationship's taken
    // from before the 6610 union of this verification. What the mapping
    // newly carries counts for (a) only (the 6590 rationale reading)
    if (rel.heldCounterpartHead === E.anchorHead) {
      const relB = Object.hasOwn(before.relationships, relId) ? before.relationships[relId] : rel
      const own = supersededIn(eRels.map((r) => (r.id === relId ? relB : r)))
      for (const x of others) if (joins(rel, x, entryRelationships(after, x), own)) take(x)
    }
    // 6580: E's anchor head changed — every relationship of another entry against E
    if (findContact(before, E.id)?.anchorHead !== E.anchorHead) {
      for (const x of others) {
        const xs = entryRelationships(after, x)
        if (feeding(after, x).some((r) => r.heldCounterpartHead === x.anchorHead && joins(r, E, eRels, supersededIn(xs)))) take(x)
      }
    }
  }
  if (!picked.length) return none
  const cs = [E, ...picked]
  const ids = cs.map((c) => c.id).sort(cmp)
  const id = 'merge:' + ids.join('|')
  const duty: MergeDuty = { kind: 'merge', v: 1, id, entryIds: ids, relId, witness: witnessOf(after, cs) }
  // a duty open for the same entries takes the new admission's witness
  if (Object.hasOwn(after.duties, id)) return { state: { ...after, duties: { ...after.duties, [id]: { ...after.duties[id], ...duty } as Duty } }, duties: [] }
  return { state: after, duties: [duty] }
}

/** The heads and superseded sets a merge is admitted against. */
function witnessOf (state: Readonly<HolderState>, cs: readonly Readonly<Contact>[]): MergeDuty['witness'] {
  const heads: Record<string, string> = {}
  const superseded: Record<string, string[]> = {}
  for (const c of cs) heads[c.id] = c.anchorHead!
  for (const y of cs) {
    const sup = supersededIn(entryRelationships(state, y))
    superseded[y.id] = unique(cs.filter((x) => x !== y && sup.has(x.anchorHead!)).map((x) => x.anchorHead!)).sort(cmp)
  }
  return { heads, superseded }
}

/**
 * Whether the merge a duty was opened for still stands (6540, 6550,
 * 6605): every entry still holds the anchor head it was admitted with, no
 * entry holds another's head as superseded beyond what it did then, the
 * relationship that opened it is still one of theirs, and the entries are
 * mergeable (the binding rule, one anchor head).
 */
function witnessHolds (state: Readonly<HolderState>, d: Readonly<MergeDuty>, cs: readonly Readonly<Contact>[]): boolean {
  const w = d.witness
  if (cs.some((c) => !Object.hasOwn(w.heads, c.id) || c.anchorHead !== w.heads[c.id])) return false
  if (!cs.some((c) => c.relIds.includes(d.relId))) return false
  for (const y of cs) {
    const sup = supersededIn(entryRelationships(state, y))
    for (const x of cs) if (x !== y && sup.has(x.anchorHead!) && !(w.superseded[y.id] ?? []).includes(x.anchorHead!)) return false
  }
  return mergeable(state, cs)
}

/** merge/1: the merge as one step after the verification commit (2230),
 *  re-checked against its witness; where it no longer holds, the duty is
 *  dropped without a trace (a later verification may open another). */
export const mergeDuty = (bound: bigint): DutyHandler => ({
  v: 1,
  apply (state, duty) {
    const d = duty as MergeDuty
    const cs = unique(d.entryIds.map((x) => findContact(state, x)).filter((c): c is Contact => c !== undefined))
    // the state moved since the commit that opened it: nothing (left) to merge
    if (cs.length < 2 || cs.some((c) => c.pos === null) || !witnessHolds(state, d, cs)) return { state: state as HolderState }
    const r = mergeEntries(state, cs, bound)
    return { state: r.state, ...(r.events ? { events: r.events } : {}), ...(r.duties ? { duties: r.duties } : {}), ...(r.renames ? { renames: r.renames } : {}) }
  },
})

// ── split (2080–2115) ──────────────────────────────────────────────────

/** The chain aliases of a relationship (2090): the identities of the
 *  husks chained into it. */
export function chainAliases (state: Readonly<HolderState>, relId: string): string[] {
  const out: string[] = []
  for (const r of Object.values(state.relationships)) {
    if (r.chainedInto === relId) out.push(r.contactId, ...chainAliases(state, r.id))
  }
  return unique(out).sort(cmp)
}

/** The husks chained into `relId`, transitively. */
const husksOf = (state: Readonly<HolderState>, relId: string): string[] =>
  Object.values(state.relationships).filter((r) => r.chainedInto === relId).flatMap((r) => [r.id, ...husksOf(state, r.id)])

/**
 * The identity an entry takes when the relationship whose identity it was
 * leaves (2100): its oldest remaining relationship's in entry-commit order
 * (firstVerified, unverified after, then active-head creation), among those
 * whose identity resolves to this entry; the relationship's id where none
 * does (a relationship behind two entries, 2145).
 */
function oldestIdentity (state: Readonly<HolderState>, c: Readonly<Contact>, remaining: readonly string[], exclude: ReadonlySet<string>): string {
  const heads = state.entryOrder.heads
  const rels = remaining.filter((id) => Object.hasOwn(state.relationships, id)).map((id) => state.relationships[id]).sort((a, b) => {
    if (a.firstVerified !== null && b.firstVerified !== null) { const d = cmpDec(a.firstVerified, b.firstVerified); if (d) return d }
    if ((a.firstVerified === null) !== (b.firstVerified === null)) return a.firstVerified === null ? 1 : -1
    return (heads.indexOf(a.id) - heads.indexOf(b.id)) || cmp(a.id, b.id)
  })
  const own = rels.find((r) => !exclude.has(r.contactId) && (r.contactId === c.id || c.aliases.includes(r.contactId)))
  return own ? own.contactId : rels[0].id
}

/** The keys of the entry's relationships resolve through its new id (2100). */
const rename = (state: HolderState, oldId: string, id: string, rels: (relId: string) => boolean, renames: IdentityRename[]): HolderState =>
  rewriteIdentity(state, [oldId], id, { rels, global: true, baselines: true, renames })

/**
 * 2080: the first verified mapping on `relId`, already in `mid`, leaves it
 * holding no anchor the other relationships of its entry hold, or another
 * binding for one they hold: the split, else null. The entry keeps its
 * position, status, the remaining relationships with their aliases and
 * its settings, frees no slot and settles its anchor head; the leaver
 * takes its identity, its chain aliases and the settings of 2115, and
 * holds no position until the caller's entry commit (2090).
 */
export function splitIfUnlinked (before: Readonly<HolderState>, mid: Readonly<HolderState>, relId: string): { state: HolderState, event: EventDraft, renames: IdentityRename[] } | null {
  if (before.relationships[relId]?.heldCounterpartHead !== null) return null
  const rel = mid.relationships[relId]
  const E = entryOf(mid, rel)
  if (!E) return null
  const others = entryRelationships(mid, E).filter((r) => r.id !== relId)
  const holding = others.filter((r) => r.heldCounterpartHead !== null)
  // 2080 read literally would split every manual merge of unmapped
  // relationships at the first mapping; open point for Trust 0.32. Here
  // the relationship stays where the others hold no anchor to contradict
  if (!holding.length) return null
  const mine = anchorSet(rel)
  const shares = holding.some((o) => [...anchorSet(o)].some((a) => mine.has(a)))
  if (shares && !conflicts([rel], others)) return null
  return splitOff(mid, relId)
}

/** The split of `relId` from its entry (2080–2115). */
export function splitOff (state: Readonly<HolderState>, relId: string): { state: HolderState, event: EventDraft, renames: IdentityRename[] } {
  const rel = state.relationships[relId]
  const E = entryOf(state, rel)!
  const identity = rel.contactId
  const chain = chainAliases(state, relId)
  const leaverIds = new Set([identity, ...chain])
  const remaining = E.relIds.filter((id) => id !== relId)
  const eId = leaverIds.has(E.id) ? oldestIdentity(state, E, remaining, leaverIds) : E.id
  // 2115: every class at default, except an `off` of the merged entry, which goes along
  const settings = {} as Record<TrustClass, Setting>
  for (const cls of CLASSES) settings[cls] = E.settings[cls] === 'off' ? 'off' : 'default'
  const groupSettings: Record<string, Setting> = {}
  for (const [g, s] of Object.entries(E.groupSettings)) if (s === 'off') groupSettings[g] = 'off'
  const contacts = { ...state.contacts }
  delete contacts[E.id]
  contacts[eId] = { ...E, id: eId, relIds: remaining, aliases: E.aliases.filter((a) => !leaverIds.has(a) && a !== eId) }
  contacts[identity] = {
    id: identity, pos: null, status: 'none', aliases: chain.filter((a) => a !== identity), relIds: [relId], anchorHead: null, settings, groupSettings,
  }
  // the leaver's keys go to its own entry (2145 entryId, its duties and recipients)
  const renames: IdentityRename[] = []
  let next = rewriteIdentity({ ...state, contacts }, [E.id, ...E.aliases], identity, { rels: (id) => id === relId, renames })
  // the remaining entry's keys that resolved through the old identity (2100)
  if (eId !== E.id) next = rename(next, E.id, eId, (id) => id !== relId, renames)
  next = { ...next, contacts: { ...next.contacts, [eId]: settleHead(next, next.contacts[eId]) } }
  // the leaver's classes start at default (2115): the trusted contacts' classes off with the anchor mapping (6410)
  next = dropOff(next).state
  return { state: next, event: { type: 'contact.split', contactId: eId, leaver: identity, relationshipId: relId }, renames }
}

// ── departure (2210, 2250, 2260, 5860) ─────────────────────────────────

const needInput = (x: unknown, name: string): Record<string, unknown> => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${name} needs an input object`)
  return x as Record<string, unknown>
}

/** The matches of every accepted star without the entry ids `ids` (6160). */
function dropMatches (state: HolderState, ids: readonly string[]): HolderState {
  if (!ids.length) return state
  let relationships: HolderState['relationships'] | null = null
  for (const [id, r] of Object.entries(state.relationships)) {
    if (!r.tuples.some((t) => t.starIn.accepted?.matches.some((m) => ids.includes(m)))) continue
    const tuples = r.tuples.map((t) => {
      const acc = t.starIn.accepted
      return acc && acc.matches.some((m) => ids.includes(m)) ? { ...t, starIn: { ...t.starIn, accepted: { ...acc, matches: acc.matches.filter((m) => !ids.includes(m)) } } } : t
    })
    ;(relationships ??= { ...state.relationships })[id] = { ...r, tuples }
  }
  return relationships ? { ...state, relationships } : state
}

/** The identities of a relationship: its own and its chain aliases. */
const identitiesOf = (state: Readonly<HolderState>, relId: string): string[] =>
  [state.relationships[relId].contactId, ...chainAliases(state, relId)]

/**
 * Departure: the relationships leave the state with their husks; an entry
 * left without relationships is removed (pending: 2260; admitted: its
 * slot frees, 2250), one that keeps some drops their aliases, takes a new
 * identity where theirs was its own (2100) and settles its anchor head
 * (2080); pending entries are admitted in position order in the same
 * step, so the set changes once (5860).
 */
export function depart (state: Readonly<HolderState>, input: TrustDepartInput, bound: bigint): Applied | Refusal {
  const c = findContact(state, input.contactId)
  if (!c) return { ok: false, code: 'unknown-contact' }
  let relIds: string[]
  if (input.relationshipId !== undefined) {
    if (!c.relIds.includes(input.relationshipId)) return { ok: false, code: 'unknown-contact' }
    relIds = [input.relationshipId]
  } else if (input.contactId !== c.id) {
    relIds = c.relIds.filter((rid) => Object.hasOwn(state.relationships, rid) && identitiesOf(state, rid).includes(input.contactId))
  } else relIds = [...c.relIds]
  const leaving = new Set(relIds.flatMap((rid) => [rid, ...husksOf(state, rid)]))
  const goneIds = new Set([...relIds.flatMap((rid) => (Object.hasOwn(state.relationships, rid) ? identitiesOf(state, rid) : []))])
  if (input.contactId !== c.id && input.relationshipId === undefined) goneIds.add(input.contactId)   // an alias without a relationship
  const relationships: HolderState['relationships'] = {}
  for (const [id, r] of Object.entries(state.relationships)) if (!leaving.has(id)) relationships[id] = r
  const contacts: HolderState['contacts'] = {}
  const renamed: Array<{ from: string, to: string, rels: string[] }> = []
  let removed = false
  const removedIds: string[] = []
  for (const x of Object.values(state.contacts)) {
    const rest = x.relIds.filter((id) => !leaving.has(id))
    if (rest.length === x.relIds.length && !x.aliases.some((a) => goneIds.has(a))) { contacts[x.id] = x; continue }
    if (!rest.length) { if (x.id === c.id) removed = true; removedIds.push(x.id); continue }
    const id = goneIds.has(x.id) ? oldestIdentity(state, x, rest, goneIds) : x.id
    if (id !== x.id) renamed.push({ from: x.id, to: id, rels: rest })
    contacts[id] = { ...x, id, relIds: rest, aliases: x.aliases.filter((a) => !goneIds.has(a) && a !== id) }
  }
  const duties: HolderState['duties'] = {}
  for (const [id, d] of Object.entries(state.duties)) {
    const relOf = (d as { relId?: unknown }).relId
    // a duty of a kind (or version) this library does not know is kept as it is
    if (typeof relOf === 'string' && leaving.has(relOf) && d.kind !== 'merge' && isKnownDuty(d)) continue
    duties[id] = d
  }
  const rotations: HolderState['rotations'] = {}
  for (const [id, r] of Object.entries(state.rotations)) {
    rotations[id] = Object.keys(r.awaitHead).some((k) => leaving.has(k))
      ? { ...r, awaitHead: Object.fromEntries(Object.entries(r.awaitHead).filter(([k]) => !leaving.has(k))) }
      : r
  }
  let next: HolderState = {
    ...state, relationships, contacts, duties, rotations,
    entryOrder: { ...state.entryOrder, heads: state.entryOrder.heads.filter((id) => !leaving.has(id)) },
  }
  // 6160: an accepted star matches the holder's contacts; one that left matches nothing
  next = dropMatches(next, removedIds)
  const renames: IdentityRename[] = []
  for (const r of renamed) next = rename(next, r.from, r.to, (id) => r.rels.includes(id), renames)
  for (const x of Object.values(next.contacts)) {
    const s = settleHead(next, x)
    if (s !== x) next = { ...next, contacts: { ...next.contacts, [x.id]: s } }
  }
  // 2850: a relationship that ceased to lag with the departure gets the classes on for it
  const f = followClasses(state, admitPending(next, bound))
  next = f.state
  return {
    ...(f.duties.length ? { duties: f.duties } : {}),
    state: next, events: [{ type: 'contact.departed', contactId: c.id, relationshipIds: relIds.filter((id) => Object.hasOwn(state.relationships, id)).sort(cmp), removed }],
    ...(renames.length ? { renames } : {}),
  }
}

// ── the commands ───────────────────────────────────────────────────────

export function entryCommands (bound: bigint): Record<string, CommandDef> {
  return {
    // rung 3: the manual merge (6640)
    [ENTRY_COMMANDS.merge]: {
      human: true,
      apply (state, _p, input: TrustMergeInput) {
        const i = needInput(input, ENTRY_COMMANDS.merge)
        if (!Array.isArray(i.contactIds) || i.contactIds.some((x) => typeof x !== 'string' || x === '')) throw new TypeError('trust.merge: contactIds must be non-empty strings')
        const cs: Contact[] = []
        for (const x of i.contactIds as string[]) {
          const c = findContact(state, x)
          if (!c) return { ok: false, code: 'unknown-contact' }
          if (!cs.includes(c)) cs.push(c)
        }
        if (cs.length < 2) return { state: state as HolderState }
        if (cs.filter((c) => c.pos !== null).length > 1) return { ok: false, code: 'not-mergeable', ref: 'RLTP-TRU-6640' }
        if (!mergeable(state, cs)) return { ok: false, code: 'not-mergeable', ref: 'RLTP-TRU-6605' }
        const r = mergeEntries(state, cs, bound)
        return { state: r.state, ...(r.events ? { events: r.events } : {}), ...(r.duties ? { duties: r.duties } : {}), ...(r.renames ? { renames: r.renames } : {}) }
      },
    } satisfies CommandDef<TrustMergeInput>,
    [ENTRY_COMMANDS.depart]: {
      human: true,
      apply (state, _p, input: TrustDepartInput) {
        const i = needInput(input, ENTRY_COMMANDS.depart)
        if (typeof i.contactId !== 'string' || i.contactId === '') throw new TypeError('trust.depart: contactId must be a non-empty string')
        if (i.relationshipId !== undefined && (typeof i.relationshipId !== 'string' || i.relationshipId === '')) throw new TypeError('trust.depart: relationshipId must be a non-empty string')
        return depart(state, i as unknown as TrustDepartInput, bound)
      },
    } satisfies CommandDef<TrustDepartInput>,
  }
}
