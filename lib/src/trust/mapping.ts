// trust/mapping — the Trust Layer's anchor mapping on the holder (lib
// Stage 2, PR 4a): the trust act and the class settings (Section 2a), the
// issuance of anchor-mapping@4 (6.1, 6300/6310, 6420), its verification
// (6.3) and the entry commit of the deliverable set (Section 2). Graduated
// from probe/trust.ts (setTrust, setTrustPaused, reissueTrust, makeMapping,
// verifyMapping, promotionCommit's first branch, receiveTrustDoc's mapping
// branch) onto HolderState and the engine; probe/trust.ts stays as it is
// for the simulators until PR 7.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// What the module registers (createHolder builds it in):
//   commands  trust.set {contactId, on}            the Trust button: the
//               anchor mapping class `on` (2770) or `off` (2840); human
//             trust.setClass {contactId, cls, setting}    2780/2810; human
//             trust.setGroupClass {contactId, groupId, setting}  2830; human
//             trust.pause {contactId, paused}       the pause of 5.4: star
//               and blinded group star `off`, or back to `default`; human
//             trust.recover {}                      2240: entries re-commit
//               from verified mappings recovered without them; non-human
//   task      anchor-mapping/0.3 (proof absent): conditions 1–7 in the
//             preparation (stage 8), condition 8 and the transition in
//             apply (stage 9): mappingIn on the arrival tuple, links and
//             bindings at chain level (6610), the counterpart head, the
//             entry commit (2060) or its update in place (2070)
//   duties    class-on/1 (2850) and reissue-mapping/1 (6370, 6596): issue
//             the current anchor-mapping@4 on one relationship; class-on of
//             the star classes is discharged by the reconciliation (5.4)
//   and, from trust/star.ts and trust/group-star.ts (PR 4b): the tasks
//             star/0.2 and group-star/0.1, the sweeps trust.star and
//             trust.groupStar run by resume, and their ack handlers
//
// Choices this file makes where note and spec leave them open:
//   - a relationship maps to exactly one entry here: the contact its active
//     tuple's entryId names (2145), else its contactId. Merge, split and
//     chaining are PR 4c. An entry whose relationships hold incomparable
//     anchor heads (a manual merge, 6640, before its split) keeps its
//     anchor head where it is among the newest, else takes the verifying
//     relationship's head
//   - mappingIn.body and mappingOut.body hold the mapping's body (the
//     artifact without its MACs): the revision rule compares bodies (6270),
//     6310 compares the issued body
//   - an equal revision with an identical body (6270 repeat, a resend under
//     a new document id) is acknowledged and changes nothing, except that
//     it re-commits an entry lost with state loss (2240); a lower revision,
//     an equivocation and an unlinked change of self (6170) are
//     failed(validation-failed) at stage 9 with the rule as ref
//   - a document carrying ceremony.enactment is failed(validation-failed):
//     a mapping has no material to recompute it against (Delivery §3)
//   - trust.received is announced at the entry commit of a verification,
//     contact.verified at every verification that changed the state; the
//     re-commit of trust.recover (no verification) announces nothing
//   - the admission bound is the constant 10¹⁸−1 (2050); trustModule takes
//     another bound for tests only, as the probe's admissionBound did
//   - 2250/2260 in part: an entry committed at a full set is
//     deliverable-pending, and trust.recover admits pending entries in
//     position order while the set has room. Admission when a departure or
//     a merge frees a slot, and the removal of a pending entry with its
//     relationship's departure (2260), arrive with departure and merge in
//     PR 4c (TODO(4c) in recommitEntries); this module claims neither
//   - the entry commit of 2240 runs on trust.recover and on any accepted
//     mapping of the relationship, the repeat included
//   - issuance needs a community anchor (register.community): without one
//     the Trust act is refused as no-community, a duty stays refused
//   - the community key agrees through the KeyProvider under a release the
//     module derives from the register (the current generation's label),
//     not from `addresses`: it is no delivery address (Delivery §5)
//   - duties are keyed deterministically, `class-on:<cls>:<relId>`; one
//     already open is not opened twice. Turning the class on opens one per
//     live relationship of the contact that does not lag (6595); turning it
//     off drops the open class-on and re-issue duties of the contact
//     (6410). A class-on duty finding the class off, its relationship gone
//     or lagging is fulfilled without sending; ceasing to lag opens a new
//     one (2850). A re-issue duty sends whether or not the relationship
//     lags now (6596) and is dropped while the class is off (6410)
//   - every issuance on a relationship fulfils every open class-on duty of
//     the anchor mapping and every re-issue owed on it (6596: one delivery
//     meets every re-issue still owed)
//   - the star, the blinded and the sealed group star are delivered by the
//     reconciliation of 5.4 (trust/star.ts), which sees every settings
//     change through its view, so changing their settings opens no class-on
//     duty; a class-on duty of one of them (from elsewhere) is fulfilled
//     without sending, since the sweep runs in the same resume after the
//     duties. A class-on duty of the profile is left waiting ('not-due')
//     for its module (PR 6)
//   - trust.pause sets star and blinded group star `off`, unpausing back to
//     `default`; it needs no trust (2780), unlike the probe's setTrustPaused
//   - setGroupClass to `default` removes the per-group entry; turning the
//     sealed group star class `off` resets every per-group `on` (5450), on
//     that transition only: a group set `on` afterwards stays, and setting
//     `off` while it is off resets nothing
import { jcs, iso, makeValidator, calOK } from '../core.js'
import type { Json } from '../core.js'
import { digestDoc, xRawOfMk } from '../crypto.js'
import { seal } from '../delivery.js'
import { communityLabel } from '../identity.js'
import { SCHEMAS } from '../schemas.js'
import {
  LINEAGE_MAX, MAPPING_CONDITION_RULE, assembleAnchorMapping, bindingOf, classifyMapping, lineageLinks,
  mappingBindings, rawProofValue, verifyAnchorMappingWith,
} from '../anchor.js'
import { tupleByRkid } from '../receive.js'
import type { Arrival, ReceivedDocument, TaskRefusal } from '../receive.js'
import type { Applied, CommandDef, DutyHandler, EventDraft, HolderModule, OutboundDraft, PrepareCtx, Refusal } from '../engine.js'
import type { KeyRelease } from '../ports.js'
import type { ClassOnDuty, Contact, Dec, Duty, HolderState, ReissueMappingDuty, Relationship, Setting, TrustClass, Tuple } from '../state.js'
import {
  ADMISSION_BOUND, CLASSES, activeTuple, classOnToward, entryRelationships, findContact, lags, newestHeads,
} from './state.js'
import { ASSEMBLY_LIMIT, STAR, STAR_TYPE, ackOf, rematchStars, retainInflight, starBlinds, sweepOf, taskOf } from './star.js'
import type { StarBlinds } from './star.js'
import { GROUP_STAR, GROUP_STAR_TYPE } from './group-star.js'

const te = new TextEncoder()
const V = makeValidator(SCHEMAS)
const mappingSchemaOk = (m: unknown): boolean =>
  V.validate(m, SCHEMAS['visibility-anchor-mapping.schema.json'], SCHEMAS['visibility-anchor-mapping.schema.json']).length === 0

/** The registered task type that carries anchor-mapping@4 (Delivery §4.4). */
export const ANCHOR_MAPPING_TYPE = 'https://real-life.org/trust-tasks/anchor-mapping/0.3'

/** The trust module's command names. */
export const TRUST_COMMANDS = Object.freeze({
  set: 'trust.set', setClass: 'trust.setClass', setGroupClass: 'trust.setGroupClass', pause: 'trust.pause', recover: 'trust.recover',
} as const)

export interface TrustSetInput { contactId: string, on: boolean }
export interface TrustSetClassInput { contactId: string, cls: TrustClass, setting: Setting }
export interface TrustSetGroupClassInput { contactId: string, groupId: string, setting: Setting }
export interface TrustPauseInput { contactId: string, paused: boolean }

/** The mapping body as verified (6020). */
interface MappingBody {
  type: 'anchor-mapping@4', pair: string, self: string, to: string
  card: { body: { type: 'self-card@2', anchor: string, keyAgreement: string, commit: string }, proof: { proofValue: string } }
  lineage: Json[], revision: Dec, issuedAt: string
}
interface AnchorMapping { body: MappingBody, proof: { mac1: string, mac2: string } }

const SETTINGS: readonly Setting[] = ['default', 'on', 'off']
const inc = (d: Dec): Dec => (BigInt(d) + 1n).toString()

// ── the community anchor and its lineage ───────────────────────────────

interface Community { genesis: string, gen: number, label: string, nextLabel: string }

/** The current generation's label and the next one's (Identity §5.4). */
function communityOf (state: Readonly<HolderState>): Community | null {
  const c = state.register.community
  if (c === null) return null
  const gen = Number(c.head)
  if (!Number.isSafeInteger(gen) || gen < 1 || gen + 1 > Number.MAX_SAFE_INTEGER) throw new Error(`trust: community head ${c.head} outside [1, 2^53 − 2] (Identity §5.4)`)
  return { genesis: c.genesis, gen, label: communityLabel(c.genesis, gen), nextLabel: communityLabel(c.genesis, gen + 1) }
}

/**
 * The lineage a mapping on one relationship carries (6020, 6420): empty
 * where nothing was issued there under an earlier anchor, otherwise the
 * holder's lineage from the element that leaves the relationship's
 * earliest anchor (2285) to `self`, at most the LINEAGE_MAX most recent.
 */
export function lineageSegment (lineage: readonly Json[], earliest: string | null, self: string): Json[] {
  if (earliest === null || earliest === self) return []
  const at = lineage.findIndex((r) => (r as { body?: { prev?: unknown } })?.body?.prev === earliest)
  if (at < 0) throw new Error('trust: a relationship\'s earliest anchor is not in the register lineage (2285, 6420)')
  const seg = lineage.slice(at)
  if ((seg[seg.length - 1] as { body: { next: string } }).body.next !== self) throw new Error('trust: the register lineage does not end at the current community anchor')
  return structuredClone(seg.slice(-LINEAGE_MAX))
}

// ── issuance (6.1, 6300/6310) ──────────────────────────────────────────

type Blocked = 'gone' | 'off' | 'deactivated' | 'lagging' | 'no-community' | 'scope-exhausted'

/** Whether the anchor mapping can go out on `relId` toward `contactId` now. */
function issuable (state: Readonly<HolderState>, contactId: string, relId: string, lagMatters: boolean):
  { ok: true, contact: Contact, rel: Relationship, tuple: Tuple } | { ok: false, why: Blocked } {
  const contact = findContact(state, contactId)
  const rel = Object.hasOwn(state.relationships, relId) ? state.relationships[relId] : undefined
  if (!contact || !rel || rel.chainedInto !== null || !contact.relIds.includes(rel.id)) return { ok: false, why: 'gone' }
  if (!classOnToward(contact, 'anchorMapping')) return { ok: false, why: 'off' }                     // 6410
  const tuple = activeTuple(rel)
  if (!tuple || tuple.deactivated) return { ok: false, why: 'deactivated' }                          // 6240
  if (lagMatters && lags(rel, entryRelationships(state, contact))) return { ok: false, why: 'lagging' } // 6595
  if (state.register.community === null) return { ok: false, why: 'no-community' }
  if (BigInt(tuple.mappingOut.rev) + 1n > ADMISSION_BOUND) return { ok: false, why: 'scope-exhausted' }  // 2.1
  return { ok: true, contact, rel, tuple }
}

/** An issuance prepared against a snapshot: the next revision of the
 *  tuple's scope and the sealed document. */
interface Issue {
  relId: string
  tuple: string
  /** the scope's revision the issuance follows; apply re-checks it (6300) */
  baseRev: Dec
  rev: Dec
  body: MappingBody
  underAnchor: string
  outbound: OutboundDraft
}

/** Build and seal the current anchor-mapping@4 for one relationship. */
async function prepareIssue (ctx: PrepareCtx, contactId: string, relId: string, lagMatters: boolean): Promise<Issue | null> {
  const st = ctx.snapshot
  const chk = issuable(st, contactId, relId, lagMatters)
  if (!chk.ok) return null
  const { contact, rel, tuple: t } = chk
  const S = ctx.crypto.subtle
  const com = communityOf(st)!
  const self = await ctx.keys.anchorOf(com.label)
  const next = await ctx.keys.anchorOf(com.nextLabel)
  const own = await ctx.keys.anchorOf(t.ownPairLabel)
  // self-card@2 under the current generation, bound to the next (6.2)
  const cardBody = { type: 'self-card@2' as const, anchor: self.anchor, keyAgreement: self.keyAgreement, commit: await bindingOf(next.anchor, S) }
  const card = { body: cardBody, proof: { proofValue: rawProofValue(await ctx.keys.sign(com.label, te.encode(jcs(cardBody)))) } }
  const rev = inc(t.mappingOut.rev)
  const body: MappingBody = {
    type: 'anchor-mapping@4', pair: own.anchor, self: self.anchor, to: t.counterpartAnchor, card,
    lineage: lineageSegment(st.register.lineage, rel.earliestAnchor, self.anchor), revision: rev, issuedAt: iso(ctx.when),
  }
  const theirX = xRawOfMk(t.counterpartKeyAgreement)
  if (!theirX) return null
  // mac1 under the tuple's own pair key, mac2 under the community key (6030)
  const sh1 = await ctx.keys.agree(t.rkid, theirX, ctx.release)
  const communityRelease: KeyRelease = (rkid) => (rkid === self.keyAgreement ? { status: 'live', label: com.label } : { status: 'unknown' })
  const sh2 = await ctx.keys.agree(self.keyAgreement, theirX, communityRelease)
  if (sh1.status !== 'available' || sh2.status !== 'available') return null
  const mapping = await assembleAnchorMapping(body, sh1.shared, sh2.shared, S)
  const threadId = ctx.entropy.id('thread.id')
  const doc = {
    id: ctx.entropy.id('doc.id'), type: ANCHOR_MAPPING_TYPE, issuer: own.anchor, recipient: t.counterpartAnchor,
    threadId, issuedAt: iso(ctx.when), payload: mapping as unknown as Json,
  }
  const envelope = await seal(doc, t.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
  return {
    relId: rel.id, tuple: t.ownPairLabel, baseRev: t.mappingOut.rev, rev, body, underAnchor: self.anchor,
    outbound: {
      digest: await digestDoc(doc, S), envelope, type: ANCHOR_MAPPING_TYPE, threadId,
      recipient: { contactId: contact.id, rkid: t.rkid, keyAgreement: t.counterpartKeyAgreement },
    },
  }
}

/** Is this duty an anchor-mapping duty owed on `relId`? */
const owedOn = (d: Duty, relId: string): boolean =>
  (d.kind === 'reissue-mapping' && (d as ReissueMappingDuty).relId === relId) ||
  (d.kind === 'class-on' && (d as ClassOnDuty).cls === 'anchorMapping' && (d as ClassOnDuty).relId === relId)

/** The issuance's commit: revision and body persisted in one step (6300),
 *  the earliest anchor (2285), every duty the delivery meets (6596); null
 *  where the scope moved since the preparation. */
function commitIssue (state: Readonly<HolderState>, p: Issue): Applied | null {
  const rel = state.relationships[p.relId]
  const i = rel.tuples.findIndex((t) => t.ownPairLabel === p.tuple)
  if (i < 0 || rel.tuples[i].mappingOut.rev !== p.baseRev) return null
  const tuples = rel.tuples.map((t, j) => (j === i ? { ...t, mappingOut: { rev: p.rev, body: p.body as unknown as Json, underAnchor: p.underAnchor } } : t))
  const duties: Record<string, Duty> = {}
  for (const [id, d] of Object.entries(state.duties)) if (!owedOn(d, p.relId)) duties[id] = d
  return {
    state: {
      ...state,
      relationships: { ...state.relationships, [rel.id]: { ...rel, tuples, earliestAnchor: rel.earliestAnchor ?? p.underAnchor } },
      duties,
    },
    outbound: [p.outbound],
  }
}

// ── the entry commit (Section 2) ───────────────────────────────────────

/** The entry a relationship's verifications go to (2145): its active
 *  tuple's entryId, by id or alias, else its contact. */
const entryOf = (state: Readonly<HolderState>, rel: Readonly<Relationship>): Contact => {
  const t = activeTuple(rel)
  return (t && findContact(state, t.entryId)) ?? state.contacts[rel.contactId]
}

const liveRel = (r: Readonly<Relationship>): boolean => {
  const t = activeTuple(r)
  return r.chainedInto === null && t !== undefined && !t.deactivated
}

/** A class-on duty of the anchor mapping on `rel`, unless one is open. */
const classOnDuty = (state: Readonly<HolderState>, contactId: string, relId: string, extra: readonly Duty[]): ClassOnDuty[] => {
  const id = `class-on:anchorMapping:${relId}`
  if (Object.hasOwn(state.duties, id) || extra.some((d) => d.id === id)) return []
  return [{ kind: 'class-on', v: 1, id, contactId, relId, cls: 'anchorMapping' }]
}

/**
 * After a verified mapping on `relId` (or on recovery): the entry commit
 * where the entry has none (2060: next position, admitted, or pending at
 * the bound, 2250), the entry's anchor head (6560), and a class-on duty
 * for every relationship of the entry that ceased to lag (2850, 6595).
 */
function commitEntry (before: Readonly<HolderState>, state: Readonly<HolderState>, relId: string, bound: bigint):
  { state: HolderState, committed: Contact | null, contact: Contact, duties: Duty[] } {
  const rel = state.relationships[relId]
  const c0 = entryOf(state, rel)
  let c: Contact = { ...c0 }
  let entryOrder = state.entryOrder
  let committed: Contact | null = null
  if (c.pos === null) {
    const admitted = BigInt(Object.values(state.contacts).filter((x) => x.status === 'admitted').length)
    c = { ...c, pos: entryOrder.nextPos, status: admitted < bound ? 'admitted' : 'pending' }
    entryOrder = { ...entryOrder, nextPos: inc(entryOrder.nextPos) }
    committed = c
  }
  const rels = entryRelationships(state, c)
  const newest = newestHeads(rels)
  const head = newest.length === 1 ? newest[0]
    : c.anchorHead !== null && newest.includes(c.anchorHead) ? c.anchorHead
      : rel.heldCounterpartHead
  c = { ...c, anchorHead: head }
  const next: HolderState = { ...state, contacts: { ...state.contacts, [c.id]: c }, entryOrder }
  // 2850: a relationship that ceased to lag gets the classes on toward the contact
  const duties: Duty[] = []
  if (classOnToward(c, 'anchorMapping')) {
    const old = entryRelationships(before, c)
    for (const r of rels) {
      const was = old.find((o) => o.id === r.id)
      if (was && lags(was, old) && !lags(r, rels) && liveRel(r)) duties.push(...classOnDuty(next, c.id, r.id, duties))
    }
  }
  return { state: next, committed, contact: c, duties }
}

/** 2250: pending entries join the set in position order while it has room. */
function admitPending (state: Readonly<HolderState>, bound: bigint): HolderState {
  let admitted = BigInt(Object.values(state.contacts).filter((x) => x.status === 'admitted').length)
  const pending = Object.values(state.contacts).filter((x) => x.status === 'pending' && x.pos !== null)
    .sort((a, b) => { const x = BigInt(a.pos!), y = BigInt(b.pos!); return x < y ? -1 : x > y ? 1 : 0 })
  let contacts: HolderState['contacts'] | null = null
  for (const c of pending) {
    if (admitted >= bound) break
    contacts ??= { ...state.contacts }
    contacts[c.id] = { ...c, status: 'admitted' }
    admitted += 1n
  }
  return contacts ? { ...state, contacts } : state as HolderState
}

/** First, pending entries are admitted in position order while the set
 *  has room (2250): they hold earlier positions than any re-commit. Then
 *  (2240) every relationship holding a verified mapping on a tuple whose
 *  entry holds no position re-commits that entry, in the order of
 *  entryOrder.heads (2180), then by relationship id, at the next position,
 *  admitted or pending by what room is left. */
export function recommitEntries (state: Readonly<HolderState>, bound: bigint = ADMISSION_BOUND): Applied {
  const order = Object.keys(state.relationships).sort((a, b) => {
    const ia = state.entryOrder.heads.indexOf(a), ib = state.entryOrder.heads.indexOf(b)
    return ((ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)) || (a < b ? -1 : a > b ? 1 : 0)
  })
  let cur = admitPending(state, bound)
  for (const id of order) {
    const rel = cur.relationships[id]
    if (!rel.tuples.some((t) => t.mappingIn.body !== null) || entryOf(cur, rel).pos !== null) continue
    cur = commitEntry(cur, cur, id, bound).state
  }
  // TODO(4c): the same admission step runs atomically with every departure
  // and merge that frees a slot (2150, 2250, 5860), and a pending entry
  // leaves with its relationship's departure (2260)
  return { state: cur }
}

// ── reception (6.3, Section 2) ─────────────────────────────────────────

const refuse = (reason: TaskRefusal['reason'], ref?: string): TaskRefusal => ({ ok: false, reason, ...(ref ? { ref } : {}) })

/** The arrival tuple, if it is the active head of a live relationship (6190, 6240). */
const arrivalTuple = (state: Readonly<HolderState>, rkid: string): { rel: Relationship, tuple: Tuple } | null => {
  const at = tupleByRkid(state, rkid)
  if (!at || at.tuple.deactivated || at.rel.chainedInto !== null || at.rel.activeHead !== at.tuple.ownPairLabel) return null
  return at
}

function mappingTask (bound: bigint) {
  return {
    proof: 'absent' as const,
    // stage 7: the payload schema, calendar-valid issuedAt (6070)
    decode (payload: unknown): AnchorMapping | TaskRefusal {
      if (!mappingSchemaOk(payload) || !calOK((payload as AnchorMapping).body.issuedAt)) return refuse('malformed', 'RLTP-TRU-6070')
      return payload as AnchorMapping
    },
    // stage 8: conditions 1–7 against the arrival tuple and the bindings
    // its relationship holds (6118), then the bindings the mapping states
    async prepare (ctx: PrepareCtx, doc: ReceivedDocument<AnchorMapping>, arrival: Arrival): Promise<{ bindings: Record<string, string>, stars: StarBlinds } | TaskRefusal> {
      if ((doc.ceremony as { enactment?: unknown } | undefined)?.enactment !== undefined) return refuse('validation-failed')
      const at = arrivalTuple(ctx.snapshot, arrival.rkid)
      if (!at) return refuse('validation-failed', 'RLTP-TRU-6240')
      const S = ctx.crypto.subtle
      const own = await ctx.keys.anchorOf(at.tuple.ownPairLabel)
      let infra: unknown = null
      const v = await verifyAnchorMappingWith(doc.payload, {
        ownAnchor: own.anchor, pair: at.tuple.counterpartAnchor, pairKeyAgreement: at.tuple.counterpartKeyAgreement,
        held: new Map(Object.entries(at.rel.bindings)),
        agree: async (theirX) => {
          try {
            const a = await ctx.keys.agree(at.tuple.rkid, theirX, ctx.release)
            return a.status === 'available' ? a.shared : null
          } catch (e) { infra = e; throw e }
        },
      }, S)
      if (infra !== null) throw infra   // a provider failure is no verdict on the mapping
      if (!v.ok) return refuse('validation-failed', v.rule ?? MAPPING_CONDITION_RULE[v.step])
      // the anchors this mapping makes held (self, both ends of its links),
      // blinded under every accepted star for the re-match of 6160
      const anchors = [...new Set([doc.payload.body.self, ...lineageLinks(doc.payload.body.lineage).flat()])]
      return { bindings: Object.fromEntries(await mappingBindings(doc.payload.body, S)), stars: await starBlinds(ctx, anchors) }
    },
    // stage 9: condition 8 (6150–6170) and the transition
    apply (state: Readonly<HolderState>, prepared: { value: { bindings: Record<string, string>, stars: StarBlinds } }, doc: ReceivedDocument<AnchorMapping>, arrival: Arrival): Applied | TaskRefusal {
      const at = arrivalTuple(state, arrival.rkid)
      if (!at) return refuse('validation-failed', 'RLTP-TRU-6240')
      const { rel, tuple: t } = at
      const b = doc.payload.body
      const rev = BigInt(b.revision)
      const cur = BigInt(t.mappingIn.rev)
      // the generic revision rule within the scope (pair, to) = this tuple (6270, 6280)
      if (rev === cur) {
        if (t.mappingIn.body === null || jcs(b) !== jcs(t.mappingIn.body)) return refuse('validation-failed', 'RLTP-TRU-6270')
        // a repeat: ignored, except an entry lost with state loss re-commits (2240)
        return entryOf(state, rel).pos === null ? { state: commitEntry(state, state, rel.id, bound).state } : { state: state as HolderState }
      }
      if (rev < cur) return refuse('validation-failed', 'RLTP-TRU-6270')
      // condition 8 against the self this relationship holds (6150), never the entry's head
      if (classifyMapping(rel.heldCounterpartHead ?? undefined, b) === 'rejected') return refuse('validation-failed', 'RLTP-TRU-6170')
      const tuples = rel.tuples.map((x) => (x.ownPairLabel === t.ownPairLabel
        ? { ...x, mappingIn: { rev: b.revision, body: b as unknown as Json, self: b.self, card: b.card as unknown as Json } }
        : x))
      // links and bindings accumulate at chain level (6610)
      const links = [...rel.links]
      for (const [prev, next] of lineageLinks(b.lineage)) if (!links.some((l) => l.prev === prev && l.next === next)) links.push({ prev, next })
      const nextRel: Relationship = {
        ...rel, tuples, links, bindings: { ...rel.bindings, ...prepared.value.bindings }, heldCounterpartHead: b.self,
      }
      const mid: HolderState = { ...state, relationships: { ...state.relationships, [rel.id]: nextRel } }
      const e = commitEntry(state, mid, rel.id, bound)
      const events: EventDraft[] = []
      if (e.committed) events.push({ type: 'trust.received', contactId: e.contact.id })
      events.push({ type: 'contact.verified', contactId: e.contact.id, relationshipId: rel.id })
      // 6160: stars already accepted are tested against the anchors now held
      return { state: rematchStars(e.state, e.contact.id, prepared.value.stars), events, ...(e.duties.length ? { duties: e.duties } : {}) }
    },
  }
}

// ── settings (Section 2a) ──────────────────────────────────────────────

const paused = (c: Readonly<Contact>): boolean => c.settings.star === 'off' && c.settings.groupStar === 'off'

/** One change of a contact's settings: 2840 and 5450 follow from it, the
 *  anchor mapping duties of 2850 and 6410, the events. */
function changeSettings (state: Readonly<HolderState>, c: Readonly<Contact>, settings: Record<TrustClass, Setting>, groupSettings: Record<string, Setting>): Applied {
  // 5450: turning the sealed group star off resets every per-group on to
  // default — on the transition only, so a group set on afterwards stays (2830)
  let groups = groupSettings
  if (c.settings.sealedGroupStar !== 'off' && settings.sealedGroupStar === 'off') groups = Object.fromEntries(Object.entries(groups).filter(([, s]) => s !== 'on'))
  const next: Contact = { ...c, settings, groupSettings: groups }
  const wasOn = classOnToward(c, 'anchorMapping')
  const isOn = classOnToward(next, 'anchorMapping')
  let duties = state.duties
  const add: Duty[] = []
  const events: EventDraft[] = []
  const s1: HolderState = { ...state, contacts: { ...state.contacts, [c.id]: next } }
  if (!wasOn && isOn) {
    // 2850: the current mapping on every live relationship that does not lag (6595)
    const rels = entryRelationships(s1, next)
    for (const r of rels) if (liveRel(r) && !lags(r, rels)) add.push(...classOnDuty(s1, next.id, r.id, add))
    events.push({ type: 'trust.given', contactId: next.id })
  }
  if (wasOn && !isOn) {
    // 6410: nothing more while off, the owed re-issues included
    duties = Object.fromEntries(Object.entries(duties).filter(([, d]) => !next.relIds.some((rid) => owedOn(d, rid))))
  }
  if (paused(c) !== paused(next)) events.push({ type: 'trust.paused', contactId: next.id, paused: paused(next) })
  return { state: { ...s1, duties }, events, ...(add.length ? { duties: add } : {}) }
}

const needString = (x: unknown, what: string): string => {
  if (typeof x !== 'string' || x === '') throw new TypeError(`${what} must be a non-empty string`)
  return x
}
const needSetting = (x: unknown): Setting => {
  if (!(SETTINGS as readonly unknown[]).includes(x)) throw new TypeError(`setting must be default, on or off, got ${String(x)}`)
  return x as Setting
}
const needInput = (x: unknown, name: string): Record<string, unknown> => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${name} needs an input object`)
  return x as Record<string, unknown>
}

/** A class setting through the one transition; `on` of the anchor mapping
 *  needs a community anchor to issue under. */
function setClass (state: Readonly<HolderState>, contactId: string, cls: TrustClass, setting: Setting): Applied | Refusal {
  const c = findContact(state, contactId)
  if (!c) return { ok: false, code: 'unknown-contact' }
  const settings = { ...c.settings, [cls]: setting }
  if (cls === 'anchorMapping' && setting === 'on' && state.register.community === null) return { ok: false, code: 'no-community' }
  return changeSettings(state, c, settings, c.groupSettings)
}

const commands: Record<string, CommandDef> = {
  // the Trust button: on (2770), or withdrawn (2840)
  [TRUST_COMMANDS.set]: {
    human: true,
    apply (state, _p, input: TrustSetInput) {
      const i = needInput(input, TRUST_COMMANDS.set)
      const contactId = needString(i.contactId, 'contactId')
      if (typeof i.on !== 'boolean') throw new TypeError('trust.set: on must be a boolean')
      const c = findContact(state, contactId)
      if (!c) return { ok: false, code: 'unknown-contact' }
      if (i.on && c.settings.anchorMapping === 'on') return { ok: false, code: 'already-given' }
      return setClass(state, contactId, 'anchorMapping', i.on ? 'on' : 'off')
    },
  } satisfies CommandDef<TrustSetInput>,
  [TRUST_COMMANDS.setClass]: {
    human: true,
    apply (state, _p, input: TrustSetClassInput) {
      const i = needInput(input, TRUST_COMMANDS.setClass)
      if (!(CLASSES as readonly unknown[]).includes(i.cls)) throw new TypeError(`trust.setClass: unknown class ${String(i.cls)}`)
      return setClass(state, needString(i.contactId, 'contactId'), i.cls as TrustClass, needSetting(i.setting))
    },
  } satisfies CommandDef<TrustSetClassInput>,
  [TRUST_COMMANDS.setGroupClass]: {
    human: true,
    apply (state, _p, input: TrustSetGroupClassInput) {
      const i = needInput(input, TRUST_COMMANDS.setGroupClass)
      const groupId = needString(i.groupId, 'groupId')
      const setting = needSetting(i.setting)
      const c = findContact(state, needString(i.contactId, 'contactId'))
      if (!c) return { ok: false, code: 'unknown-contact' }
      const groups = { ...c.groupSettings }
      if (setting === 'default') delete groups[groupId]
      else groups[groupId] = setting
      return changeSettings(state, c, c.settings, groups)
    },
  } satisfies CommandDef<TrustSetGroupClassInput>,
  // the pause of 5.4: star and blinded group star off (2780)
  [TRUST_COMMANDS.pause]: {
    human: true,
    apply (state, _p, input: TrustPauseInput) {
      const i = needInput(input, TRUST_COMMANDS.pause)
      if (typeof i.paused !== 'boolean') throw new TypeError('trust.pause: paused must be a boolean')
      const c = findContact(state, needString(i.contactId, 'contactId'))
      if (!c) return { ok: false, code: 'unknown-contact' }
      const s: Setting = i.paused ? 'off' : 'default'
      return changeSettings(state, c, { ...c.settings, star: s, groupStar: s }, c.groupSettings)
    },
  } satisfies CommandDef<TrustPauseInput>,
}

// ── duties ─────────────────────────────────────────────────────────────

/** What a blocked issuance means for a duty: fulfilled without sending
 *  (the class is off, the relationship gone or lagging), or kept. */
const blocked = (state: Readonly<HolderState>, why: Blocked): Applied | Refusal =>
  why === 'no-community' ? { ok: false, code: 'no-community' }
    : why === 'scope-exhausted' ? { ok: false, code: 'scope-exhausted', ref: 'RLTP-TRU-6310' }
      : { state: state as HolderState }

/** The classes whose class-on (2850) the reconciliation of 5.4 discharges. */
const RECONCILED: readonly TrustClass[] = ['star', 'groupStar', 'sealedGroupStar']

const issueDuty = (lagMatters: boolean): DutyHandler<Issue | null> => ({
  v: 1,
  prepare: (ctx, duty) => {
    const d = duty as ClassOnDuty | ReissueMappingDuty
    if (d.kind === 'class-on' && d.cls !== 'anchorMapping') return Promise.resolve(null)
    return prepareIssue(ctx, d.contactId, d.relId, lagMatters)
  },
  apply (state, duty, ctx) {
    const d = duty as ClassOnDuty | ReissueMappingDuty
    // 2850: the star and the group star go out through the reconciliation
    // of 5.4, whose sweep runs in this same resume after the duties (5850)
    if (d.kind === 'class-on' && RECONCILED.includes(d.cls)) return { state: state as HolderState }
    if (d.kind === 'class-on' && d.cls !== 'anchorMapping') return 'not-due'   // its class's module delivers it (profile, PR 6)
    const chk = issuable(state, d.contactId, d.relId, lagMatters)
    if (!chk.ok) return blocked(state, chk.why)
    const p = ctx.prepared.value
    if (p === null) return { ok: false, code: 'no-own-channel', ref: 'RLTP-TRU-6140' }   // no usable key agreement
    return commitIssue(state, p) ?? 'not-due'
  },
})

/** 6596: an owed re-issue waits until its relationship presents the
 *  awaited head H as its anchor head, or a later anchor whose links carry
 *  H as a prev. A relationship gone releases the duty, which then drops. */
const reissueAwaits = (state: Readonly<HolderState>, duty: Duty): boolean => {
  const d = duty as ReissueMappingDuty
  if (!Object.hasOwn(state.relationships, d.relId)) return true
  const rel = state.relationships[d.relId]
  return d.awaitHead === null || rel.heldCounterpartHead === d.awaitHead || rel.links.some((l) => l.prev === d.awaitHead)
}

// ── the module ─────────────────────────────────────────────────────────

export interface TrustModuleOptions {
  /** the deliverable set's bound (2050); another value is for tests only */
  admissionBound?: bigint
  /** the receiver's resource limit of 5365 (highest seq of an open
   *  assembly) for star and group star; default ASSEMBLY_LIMIT, another
   *  value is for tests only */
  assemblyLimit?: number
}

/** The trust module createHolder builds in (see the header). */
export function trustModule (opts: TrustModuleOptions = {}): HolderModule {
  const bound = opts.admissionBound ?? ADMISSION_BOUND
  if (typeof bound !== 'bigint' || bound < 0n || bound > ADMISSION_BOUND) throw new RangeError('admissionBound must be a bigint within [0, 10^18 − 1]')
  const limit = opts.assemblyLimit
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new RangeError('assemblyLimit must be a positive integer')
  return Object.freeze({
    name: 'trust',
    commands: Object.freeze({
      ...commands,
      [TRUST_COMMANDS.recover]: { human: false, apply: (state: Readonly<HolderState>) => recommitEntries(state, bound) } satisfies CommandDef<unknown>,
    }),
    tasks: Object.freeze({
      [ANCHOR_MAPPING_TYPE]: mappingTask(bound),
      [STAR_TYPE]: taskOf(STAR, limit ?? ASSEMBLY_LIMIT.star),
      [GROUP_STAR_TYPE]: taskOf(GROUP_STAR, limit ?? ASSEMBLY_LIMIT.groupStar),
    }),
    duties: Object.freeze({
      'class-on': issueDuty(true),
      'reissue-mapping': { ...issueDuty(false), awaitHolds: reissueAwaits },
    }),
    // 5.4: the star first, then the group star, each its own scope (5730)
    sweeps: Object.freeze({ 'trust.star': sweepOf(STAR), 'trust.groupStar': sweepOf(GROUP_STAR) }),
    acks: Object.freeze({ [STAR_TYPE]: ackOf(STAR), [GROUP_STAR_TYPE]: ackOf(GROUP_STAR) }),
    // in-flight deliveries that can no longer complete leave on tick
    retain: (state: Readonly<HolderState>) => retainInflight(state),
  })
}

