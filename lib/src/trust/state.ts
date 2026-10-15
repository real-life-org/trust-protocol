// trust/state — pure reads of the Trust Layer over HolderState (lib Stage 2,
// PR 4a, 4c): the class resolution of Section 2a, the trusted set (2020),
// the entry's relationships and anchor head (2145, 6560), lagging (6595),
// the entry a relationship's verifications go to (2145, 2146) and the
// head rule and binding rule of the net (6530–6605). No crypto, no engine; views.ts and the trust module read through here,
// so the two cannot disagree.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
import type { Contact, HolderState, Relationship, Setting, TrustClass, Tuple } from '../state.js'

/** The deliverable set's bound, 10¹⁸−1 (2050): the wire-integer domain. */
export const ADMISSION_BOUND = 10n ** 18n - 1n

/** The five classes, in the table's order (2720). */
export const CLASSES: readonly TrustClass[] = Object.freeze(['star', 'groupStar', 'anchorMapping', 'sealedGroupStar', 'profile'])

/** 2760: star and blinded group star go to every contact, the anchor
 *  mapping to none, sealed group star and profile to the trusted contacts. */
export const classOn = (cls: TrustClass, setting: Setting, isTrusted: boolean): boolean => {
  if (setting !== 'default') return setting === 'on'
  if (cls === 'star' || cls === 'groupStar') return true
  if (cls === 'anchorMapping') return false
  return isTrusted
}

/** 2020: a trusted contact is one toward which the anchor mapping class is
 *  on; its default is no contact (2760), so only `on` makes one. */
export const trusted = (c: Readonly<Contact>): boolean => c.settings.anchorMapping === 'on'

/** Whether `cls` is on toward the contact (2760, 2840). */
export const classOnToward = (c: Readonly<Contact>, cls: TrustClass): boolean => classOn(cls, c.settings[cls], trusted(c))

/** The relationship's active-head tuple (6.4). */
export const activeTuple = (r: Readonly<Relationship>): Tuple | undefined => r.tuples.find((t) => t.ownPairLabel === r.activeHead)

/** A contact by entry id or alias (2140). */
export const findContact = (state: Readonly<HolderState>, id: string): Contact | undefined => {
  if (Object.hasOwn(state.contacts, id)) return state.contacts[id]
  return Object.values(state.contacts).find((c) => c.aliases.includes(id))
}

/** The entry's own relationships (Contact.relIds), as present in the state. */
export const entryRelationships = (state: Readonly<HolderState>, c: Readonly<Contact>): Relationship[] =>
  c.relIds.filter((id) => Object.hasOwn(state.relationships, id)).map((id) => state.relationships[id])

/**
 * Whether a relationship lags in its entry (Section 2, 6595): its anchor
 * head is held in the entry as superseded, the `prev` of a link one of
 * the entry's relationships holds. `entry` is the entry's relationships,
 * `r` among them or not. A relationship with no anchor head never lags.
 */
export const lags = (r: Readonly<Relationship>, entry: readonly Readonly<Relationship>[]): boolean =>
  r.heldCounterpartHead !== null && entry.some((o) => o.links.some((l) => l.prev === r.heldCounterpartHead))

/** Every tuple's place: the relationship holding the tuple with own pair
 *  label `label` (deactivated ones included). */
export function tupleByLabel (state: Readonly<HolderState>, label: string): { rel: Relationship, tuple: Tuple } | null {
  for (const id of Object.keys(state.relationships).sort()) {
    const rel = state.relationships[id]
    const tuple = rel.tuples.find((t) => t.ownPairLabel === label)
    if (tuple) return { rel, tuple }
  }
  return null
}

/** A live relationship: not chained into another, its active head not deactivated. */
export const liveRel = (r: Readonly<Relationship>): boolean => {
  const t = activeTuple(r)
  return r.chainedInto === null && t !== undefined && !t.deactivated
}

/**
 * The entry a relationship's verifications go to (2145): the one its
 * active tuple's entryId names, by id or alias, else the one its own
 * identity (contactId) names. Where a relationship stands behind two
 * entries, this is the appended tuple's (2146).
 */
export const entryOf = (state: Readonly<HolderState>, rel: Readonly<Relationship>): Contact | undefined => {
  const t = activeTuple(rel)
  return (t && findContact(state, t.entryId)) ?? findContact(state, rel.contactId)
}

/** The entry's relationships whose verifications go to it (2145): all of
 *  them, except one that stands behind two entries and feeds the other. */
export const feeding = (state: Readonly<HolderState>, c: Readonly<Contact>): Relationship[] =>
  entryRelationships(state, c).filter((r) => entryOf(state, r)?.id === c.id)

/** The newest of `heads` along `links` (6560): those from which no other
 *  head is reachable. One where every pair of heads lies on one chain. */
export function newestOf (heads: readonly string[], links: ReadonlyArray<{ prev: string, next: string }>): string[] {
  const next = new Map<string, string[]>()
  for (const l of links) next.set(l.prev, [...(next.get(l.prev) ?? []), l.next])
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const todo = [...(next.get(from) ?? [])]
    while (todo.length) {
      const n = todo.pop()!
      if (n === to) return true
      if (!seen.has(n)) { seen.add(n); todo.push(...(next.get(n) ?? [])) }
    }
    return false
  }
  const hs = [...new Set(heads)]
  return hs.filter((h) => !hs.some((o) => o !== h && reaches(h, o)))
}

/**
 * The newest anchor heads of a set of relationships (6560): the heads from
 * which no other head is reachable along the links they hold. One entry's
 * relationships yield exactly one where the head rule and the binding rule
 * admitted every merge (6605); a manual merge (6640) may yield more until
 * its split (2080).
 */
export function newestHeads (rels: readonly Readonly<Relationship>[]): string[] {
  return newestOf(rels.map((r) => r.heldCounterpartHead).filter((h): h is string => h !== null), rels.flatMap((r) => r.links))
}

/** What an entry holds as superseded (6540): every prev of a link one of its relationships holds. */
export const supersededIn = (rels: readonly Readonly<Relationship>[]): Set<string> =>
  new Set(rels.flatMap((r) => r.links.map((l) => l.prev)))

/** A relationship's verified anchor set (6a.1 rung 2): its self and every anchor of its links. */
export const anchorSet = (r: Readonly<Relationship>): Set<string> => {
  const out = new Set<string>()
  if (r.heldCounterpartHead !== null) out.add(r.heldCounterpartHead)
  for (const l of r.links) { out.add(l.prev); out.add(l.next) }
  return out
}

/**
 * The binding rule (6605), entry against entry: a relationship of the one
 * and a relationship of the other hold different pre-rotation bindings
 * for one anchor both hold, or links from one prev to different nexts (a
 * held link fixes the binding of its prev, 6610). Compared relationship by
 * relationship, never combined (6610).
 */
export function conflicts (as: readonly Readonly<Relationship>[], bs: readonly Readonly<Relationship>[]): boolean {
  for (const a of as) {
    for (const b of bs) {
      if (a.links.some((l) => b.links.some((m) => l.prev === m.prev && l.next !== m.next))) return true
      for (const [anchor, commit] of Object.entries(a.bindings)) if (Object.hasOwn(b.bindings, anchor) && b.bindings[anchor] !== commit) return true
    }
  }
  return false
}

/**
 * The head rule (6530, 6540) for relationship `r` against entry `x`
 * (relationships `xs`): (a) r's anchor head is x's or the lineage r holds
 * carries x's as a prev, and (b) x does not hold r's anchor head as
 * superseded, nor r's own entry x's (`ownSuperseded`). For the incoming
 * relationship the caller takes its entry as it stood before the
 * verification: only what the committed mapping newly carries connects
 * (6590).
 */
export const joins = (r: Readonly<Relationship>, x: Readonly<Contact>, xs: readonly Readonly<Relationship>[], ownSuperseded: ReadonlySet<string>): boolean =>
  r.heldCounterpartHead !== null && x.anchorHead !== null &&
  (r.heldCounterpartHead === x.anchorHead || r.links.some((l) => l.prev === x.anchorHead)) &&
  !supersededIn(xs).has(r.heldCounterpartHead) && !ownSuperseded.has(x.anchorHead)
