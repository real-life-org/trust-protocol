// trust/continuity — continuity on the holder (lib Stage 2, PR 4c; Trust
// §6a, 6.4): the probe (6a.2), the continuity mapping (6a.4) and the
// chaining it triggers, with the standing duties of 6a.3. Graduated from
// probe/continuity.ts (buildProbe, receiveContinuity, handleProbe,
// handleMapping, flushContinuity, chainTuple) and probe/trust.ts
// (chainAdmission) onto HolderState and the engine; probe/continuity.ts
// stays as it is for the simulators until PR 7. The pure wire forms are
// the root module's (continuity.ts).
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md).
//
// What it registers (through trustModule, trust/mapping.ts):
//   tasks   continuity-probe/0.1 (proof absent): the assembly per tuple
//           (6790, the 5.2a rules with `probe` as the salt), the highest
//           completed probe (6690, 6700), the matches against the own
//           prior-candidate set (6800) and what they trigger: the record
//           side's choice, chained atomically with its issuance (6900),
//           or the non-record side's match report
//           continuity-mapping/0.1 (proof absent): steps 1–6 of 6940 (to,
//           next, prior in the frozen prior-candidate set, both MACs, the
//           revision rule with the record freeze, 6270, 6290); a record
//           side's mapping chains (6900) and raises the alignment (6850,
//           6930); a match report may inform the record side's choice
//           (6910) and answers it where it names the chosen relationship
//   duty    continuity/1: step `probe` sends the pending probe (6830),
//           step `mapping` produces an owed choice, report or alignment, or
//           resends the last issuance under its revision (6840)
//   acks    a completed probe ends the probe duty; the alignment's
//           delivery ends the alignment duty (6850)
//   failures  a failed probe chunk re-opens the probe duty (a fresh probe,
//           6710, 6830); a failed mapping not yet answered re-opens the
//           mapping duty (6840)
//
// What it exports for tests and the encounter (PR 7): openTuple, the
// fresh tuple with its prior-candidate set frozen (2300) and its pending
// probe (6820, 6830), behind the testing module's non-human command
// continuity.newTuple.
//
// Choices this file makes where note and spec leave them open:
//   - the prior-candidate set is the active-head tuples of every live
//     relationship at tuple creation, in the order their heads were
//     created (entryOrder.heads), the fresh tuple excluded (2300, 6740)
//   - a probe is pending from the tuple's creation (6820) and goes out on
//     the next resume (the next available delivery contact). The probe
//     duty stands until a probe completes: after each send it is due again
//     after the holder's retry backoff (DutyCtx.backoff, growing with its
//     attempt) and then sends a fresh probe, next sequence, fresh padding
//     (6710, 6830). The outbox never reproduces a probe (ownRetries); a
//     failed chunk (report, give-up) makes the duty due at once
//   - the record side chooses the first match, in prior-candidate order,
//     whose tuple is still the active head of a live relationship; the
//     non-record side reports the first such match. A match report that
//     reaches a record side without a choice is chosen from where its
//     prior is still chainable (6910)
//   - a choice, a report or an alignment whose preparation fails (a key
//     not available) leaves `continuityOut.due` and a mapping duty; the
//     receive still commits (its ack, the assembly, the revision)
//   - every issuance opens the standing mapping duty; while the issuance
//     stands it resends after the backoff (6840): the stored artifact (body
//     and proof) re-sealed in a new document, same revision, a repeat at
//     the receiver (6270), but only when no document of it is still with
//     the outbox (whose retries are byte-identical, Delivery 4.2); a
//     failure makes it due at once. The record side's choice stands until
//     the counterpart's mapping on the chosen relationship arrives
//     (`aligned`; a report on it, verified again after the choice, counts),
//     the match report until the record side's mapping is verified (6850,
//     6860: it is never produced after), the alignment until its delivery
//     completes (6850). A non-record side whose report already names the
//     chosen relationship sends that report again as its answer (6930).
//     The outbox's retries of an issued report run to their horizon like
//     superseded star salts; the record side rejects a lower revision
//   - tick keeps the address key of a deactivated prior tuple while a live
//     fresh tuple whose flow is open names it among its prior candidates
//     (continuityKeys, the engine's keepKeys): mac1 needs it (6970)
//   - a prior that a competing chaining took (deactivated, its chain's
//     head another tuple) is refused at the record side's mapping as
//     validation-failed with ref 6900; a chaining replayed is one append
//     (6230): a record-side mapping on an already chained tuple chains
//     nothing again
//   - chaining keeps the chain's relationship id (the chain continues);
//     the fresh relationship stays as a husk without tuples, chainedInto
//     the chain, its contactId a chain alias (2090). The chain takes the
//     fresh relationship's place in entryOrder.heads (2180). Chain state
//     carries (2280): links and bindings as the union (6610), a binding
//     conflict kept as two bindings for one anchor, which the binding rule
//     sees: the two entries behind the chain never merge, no merge duty
//     opens, and no mapping touching that anchor verifies on the chain
//     (6118); the chaining itself happens (6900), the earliest anchor as the earlier of the two
//     by generation of the own register lineage (2285), contact memory
//     (the chain's wins), the relationship's anchor head (the appended
//     tuple's verified self, else the chain's), firstVerified the earlier;
//     provenance stays the chain's. Tuple state does not migrate (6250):
//     the prior tuple is deactivated with its open assemblies discarded
//     (5360), the fresh tuple keeps its own scopes, so its star baseline
//     is fresh unless it completed a delivery before (5810, 5820)
//   - the entries at chaining: where both relationships hold an entry,
//     the appended tuple keeps its entry and the chain stands behind both
//     (2145) until a merge duty merges them; where only one holds one,
//     that one takes the other contact as an alias, the settings merged
//     by 2160; where neither does, the chain's contact takes the fresh one
//     as an alias (the chain continues; 2180 decides merges, and this is
//     an append)
//   - after a chaining whose entry has the anchor mapping class on, a
//     class-on duty owes the mapping on the new head (6980) where nothing
//     was issued on it, or where the chain and the tuple were issued under
//     different community anchors (6985); its lineage starts at the
//     chain's earliest anchor (2285). The duty respects lagging (6595):
//     a lagging relationship gets it when it ceases to lag (2850)
//   - at a chaining, the class-on and re-issue duties owed on the chain and
//     on the appended relationship move to the chain under the entry that
//     takes its verifications (2146); several re-issues become one, the
//     most urgent awaited head kept (relocateDuties)
//   - 6465 (the profile on the new head after a chaining) is profile@1's,
//     PR 6: the hook is afterChain below
import { iso, jcs } from '../core.js'
import type { Json } from '../core.js'
import { digestDoc } from '../crypto.js'
import { seal } from '../delivery.js'
import {
  assembleContinuityMapping, blindPrior, buildProbeChunks, continuityMacsOk, continuityMappingOk, isRecordSide, probeChunkMacOk,
  probeChunkOk, probeKeyOf, PROBE_CHUNK,
} from '../continuity.js'
import type { ContinuityMapping, ContinuityMappingBody, ProbeChunk } from '../continuity.js'
import { strictlyAscending } from '../star.js'
import { tupleByRkid } from '../receive.js'
import type { Arrival, ReceivedDocument, TaskDiscarded, TaskRefusal } from '../receive.js'
import type { AckHandler, Applied, CommandDef, DutyHandler, EventDraft, FailureHandler, HolderModule, IdentityRename, OutboundDraft, PrepareCtx, Refusal, TaskHandler } from '../engine.js'
import { triasOf } from '../state.js'
import type { ClassOnDuty, Contact, ContinuityDuty, ContinuityOut, Dec, Duty, HolderState, Millis, ReissueMappingDuty, Relationship, Tuple, TupleRef } from '../state.js'
import { emptyTuple } from '../state-builder.js'
import { ADMISSION_BOUND, activeTuple, classOnToward, entryOf, liveRel, tupleByLabel, unionBindings } from './state.js'
import { assembledBodies, assemblyStep, canComplete, chunkDocument, discardAssemblies, pairShared } from './star.js'
import { classOnDuty, mergeDutiesAfter, mergeInto } from './entries.js'

/** The registered task types of 6a (Delivery §4.4, 6810). */
export const CONTINUITY_PROBE_TYPE = 'https://real-life.org/trust-tasks/continuity-probe/0.1'
export const CONTINUITY_MAPPING_TYPE = 'https://real-life.org/trust-tasks/continuity-mapping/0.1'

/** The testing module's command (./testing). */
export const NEW_TUPLE = 'continuity.newTuple'

const inc = (d: Dec): Dec => (BigInt(d) + 1n).toString()
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const refuse = (reason: TaskRefusal['reason'], ref?: string): TaskRefusal => ({ ok: false, reason, ...(ref ? { ref } : {}) })
const probeDutyId = (label: string): string => `continuity:probe:${label}`
const mappingDutyId = (label: string): string => `continuity:mapping:${label}`

// ── reads ──────────────────────────────────────────────────────────────

/** The tuple `label` if it is the active head of a live relationship. */
function liveHead (state: Readonly<HolderState>, label: string): { rel: Relationship, tuple: Tuple } | null {
  const at = tupleByLabel(state, label)
  if (!at || !liveRel(at.rel) || at.rel.activeHead !== label) return null
  return at
}

/** The arrival tuple, if it is the active head of a live relationship (6190, 6240). */
function arrivalTuple (state: Readonly<HolderState>, rkid: string): { rel: Relationship, tuple: Tuple } | null {
  const at = tupleByRkid(state, rkid)
  if (!at || !liveRel(at.rel) || at.rel.activeHead !== at.tuple.ownPairLabel) return null
  return at
}

/** A prior the fresh tuple `label` can still be chained onto: a tuple of
 *  another relationship, its live active head. */
const chainable = (state: Readonly<HolderState>, label: string, prior: string): boolean => {
  const p = liveHead(state, prior)
  const t = tupleByLabel(state, label)
  return p !== null && t !== null && p.rel.id !== t.rel.id
}

/** The tuple `label` with `fn` applied, wherever it lives. */
function withTuple (state: Readonly<HolderState>, label: string, fn: (t: Tuple) => Tuple): HolderState {
  const at = tupleByLabel(state, label)
  if (!at) throw new Error(`continuity: no tuple ${label}`)
  const tuples = at.rel.tuples.map((t) => (t.ownPairLabel === label ? fn(t) : t))
  return { ...state, relationships: { ...state.relationships, [at.rel.id]: { ...at.rel, tuples } } }
}

/** A probe is owed until one completed (6830). */
const probeOwed = (_state: Readonly<HolderState>, t: Readonly<Tuple>): boolean => !t.probeOut.done

/** The fresh tuple's continuity flow is still open: no answered
 *  issuance, and something chosen, reported, owed or not yet probed. */
const flowOpen = (t: Readonly<Tuple>): boolean =>
  !t.continuityOut.aligned && (t.continuityOut.chosen !== null || t.continuityIn.recordPrior !== null || t.continuityOut.reported !== null ||
    t.continuityOut.due !== null || !t.probeOut.done || t.probeIn.hwm === '0')

/** The own rkids of deactivated prior tuples that a live fresh tuple with
 *  an open flow still names (2300, 6200): their keys verify mac1 (6970)
 *  and issue it, so tick keeps them (engine keepKeys). */
export function continuityKeys (state: Readonly<HolderState>): string[] {
  const out = new Set<string>()
  for (const rel of Object.values(state.relationships)) {
    if (!liveRel(rel)) continue
    const t = activeTuple(rel)!
    if (!t.priorCandidates.length || !flowOpen(t)) continue
    for (const pc of t.priorCandidates) {
      const at = tupleByLabel(state, pc.ownPairLabel)
      if (at && at.tuple.deactivated) out.add(at.tuple.rkid)
    }
  }
  return [...out]
}

/** The own pair label of the prior-candidate entry whose counterpart anchor is `anchor` (6960). */
const priorOf = (t: Readonly<Tuple>, anchor: string): TupleRef | undefined =>
  t.priorCandidates.find((pc) => pc.counterpartAnchor === anchor && pc.counterpartAnchor !== t.counterpartAnchor && pc.ownPairLabel !== t.ownPairLabel)

/** Whether the last issuance still stands (6840, 6850, 6860), and the
 *  record side's view of it. */
function issuanceStands (t: Readonly<Tuple>, record: boolean): boolean {
  const o = t.continuityOut
  if (o.body === null) return false
  if (record) return !o.aligned
  if (t.continuityIn.recordPrior === null) return true          // the match report, until the choice is verified
  const chosen = priorOf(t, t.continuityIn.recordPrior)?.ownPairLabel
  return o.reported === chosen && !o.aligned                     // the alignment, until its delivery completes
}

/** The record side of a tuple, read from its last issuance or its prior state. */
const recordOf = (t: Readonly<Tuple>): boolean | null => {
  if (t.continuityOut.chosen !== null) return true
  if (t.continuityOut.reported !== null || t.continuityIn.recordPrior !== null) return false
  return null
}

// ── a fresh tuple (2300, 6820) ─────────────────────────────────────────

export interface NewTupleInput {
  relId: string
  contactId: string
  ownPairLabel: string
  counterpartAnchor: string
  counterpartKeyAgreement: string
  provenance?: { kind: 'ceremony' | 'introduced', via?: string }
}

/**
 * A fresh tuple toward a counterpart as its own relationship and contact
 * (Encounter §4.4: fresh-always), its prior-candidate set frozen now
 * (2300), its own rkid live, its probe pending (6820, 6830).
 */
export function openTuple (state: Readonly<HolderState>, i: NewTupleInput, rkid: string, when: Millis): Applied {
  if (Object.hasOwn(state.relationships, i.relId)) throw new Error(`${NEW_TUPLE}: relationship ${i.relId} exists`)
  if (Object.hasOwn(state.contacts, i.contactId) || Object.values(state.contacts).some((c) => c.aliases.includes(i.contactId))) throw new Error(`${NEW_TUPLE}: contact ${i.contactId} exists`)
  if (tupleByLabel(state, i.ownPairLabel)) throw new Error(`${NEW_TUPLE}: label ${i.ownPairLabel} is in use`)
  const heads = state.entryOrder.heads
  const priorCandidates: TupleRef[] = Object.values(state.relationships)
    .filter((r) => liveRel(r))
    .sort((a, b) => (heads.indexOf(a.id) - heads.indexOf(b.id)) || cmp(a.id, b.id))
    .map((r) => activeTuple(r)!)
    .map((t) => ({ ownPairLabel: t.ownPairLabel, counterpartAnchor: t.counterpartAnchor }))
  const tuple = emptyTuple({
    ownPairLabel: i.ownPairLabel, counterpartAnchor: i.counterpartAnchor, counterpartKeyAgreement: i.counterpartKeyAgreement, rkid,
    entryId: i.contactId, priorCandidates,
  })
  const rel: Relationship = {
    id: i.relId, contactId: i.contactId, tuples: [tuple], activeHead: i.ownPairLabel, earliestAnchor: null, links: [], bindings: {},
    heldCounterpartHead: null, memory: {}, chainedInto: null, firstVerified: null,
    provenance: { kind: i.provenance?.kind ?? 'ceremony', ...(i.provenance?.via !== undefined ? { via: i.provenance.via } : {}), at: when },
  }
  const contact: Contact = {
    id: i.contactId, pos: null, status: 'none', aliases: [], relIds: [i.relId], anchorHead: null,
    settings: { star: 'default', groupStar: 'default', anchorMapping: 'default', sealedGroupStar: 'default', profile: 'default' }, groupSettings: {},
  }
  const duty: ContinuityDuty = { kind: 'continuity', v: 1, id: probeDutyId(i.ownPairLabel), relId: i.relId, tuple: i.ownPairLabel, step: 'probe' }
  return {
    state: {
      ...state,
      register: { ...state.register, labels: state.register.labels.includes(i.ownPairLabel) ? state.register.labels : [...state.register.labels, i.ownPairLabel] },
      addresses: { ...state.addresses, keys: { ...state.addresses.keys, [rkid]: { label: i.ownPairLabel, lastShown: when } } },
      contacts: { ...state.contacts, [i.contactId]: contact },
      relationships: { ...state.relationships, [i.relId]: rel },
      entryOrder: { ...state.entryOrder, heads: [...state.entryOrder.heads, i.relId] },
    },
    events: [{ type: 'contact.added', contactId: i.contactId }],
    duties: [duty],
  }
}

// ── the chaining (6220–6250, 2145, 2280, 2285, 6610) ───────────────────

/** The generation order of own community anchors along the register's
 *  lineage (2285): the index of the element leaving the anchor, or the
 *  lineage's length for its end; with no lineage, every anchor is one. */
function generationOf (state: Readonly<HolderState>, anchor: string): number {
  const lin = state.register.lineage as Array<{ body?: { prev?: string, next?: string } }>
  if (!lin.length) return 0
  const at = lin.findIndex((r) => r.body?.prev === anchor)
  if (at >= 0) return at
  return lin[lin.length - 1].body?.next === anchor ? lin.length : Number.MAX_SAFE_INTEGER
}

const earlierAnchor = (state: Readonly<HolderState>, a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : generationOf(state, b) < generationOf(state, a) ? b : a

/** The anchors the holder issued its anchor mapping under on these tuples and relationship. */
const issuedUnder = (r: Readonly<Relationship>): string[] =>
  [r.earliestAnchor, ...r.tuples.map((t) => t.mappingOut.underAnchor)].filter((a): a is string => a !== null)

/**
 * The class and re-issue duties owed on the chain and the appended
 * relationship, after a chaining: on the chain, under the entry that takes
 * its verifications (2146), none dropped. Several re-issues are one (6596:
 * one delivery meets every re-issue owed), the most urgent awaited head
 * kept (null, due at once, wins; else the chain's); several class-on
 * duties of one class are one.
 */
function relocateDuties (state: HolderState, from: readonly string[], relId: string, contactId: string): HolderState {
  const owed = Object.values(state.duties)
    .filter((d) => (d.kind === 'class-on' || d.kind === 'reissue-mapping') && from.includes((d as { relId: string }).relId))
    .sort((a, b) => from.indexOf((a as { relId: string }).relId) - from.indexOf((b as { relId: string }).relId))
  if (!owed.length) return state
  const duties = { ...state.duties }
  for (const d of owed) delete duties[d.id]
  const reissues = owed.filter((d): d is ReissueMappingDuty => d.kind === 'reissue-mapping')
  if (reissues.length) {
    const base = reissues[0]
    const awaitHead = reissues.some((d) => d.awaitHead === null) ? null : base.awaitHead
    duties[base.id] = { ...base, contactId, relId, awaitHead }
  }
  for (const d of owed.filter((x): x is ClassOnDuty => x.kind === 'class-on')) {
    const id = `class-on:${d.cls}:${relId}`
    if (!Object.hasOwn(duties, id)) duties[id] = { ...d, id, contactId, relId }
  }
  return { ...state, duties }
}

/**
 * 6465: after a chaining toward whose contact the profile class is on,
 * the current profile SHOULD go out on the new head. profile@1 arrives in
 * PR 6; until then this hook opens nothing.
 */
const afterChain = (_state: Readonly<HolderState>, _relId: string): Duty[] => []

export type Chained = { state: HolderState, events: EventDraft[], duties: Duty[], renames: IdentityRename[] }

/**
 * The chain append (6220): the fresh tuple `label` becomes the active head
 * of the chain whose active head `prior` is, atomically with that prior's
 * deactivation; chain state carries, tuple state does not (6250). Returns
 * `already` where this very append is done (6230), `taken` where the prior
 * is no longer chainable.
 */
export function chainTuple (state: Readonly<HolderState>, label: string, prior: string, bound: bigint): Chained | 'already' | 'taken' {
  const fresh = tupleByLabel(state, label)
  const pr = tupleByLabel(state, prior)
  if (!fresh || !pr) return 'taken'
  if (fresh.rel.id === pr.rel.id) return fresh.rel.activeHead === label && pr.tuple.deactivated ? 'already' : 'taken'
  // a strand absorbs no second one (2220): the fresh tuple's relationship is just this tuple
  if (fresh.rel.tuples.length !== 1 || !liveRel(fresh.rel) || fresh.rel.activeHead !== label) return 'taken'
  if (!liveRel(pr.rel) || pr.rel.activeHead !== prior) return 'taken'
  const R0 = pr.rel, Rn = fresh.rel
  const t = fresh.tuple
  const Eo = entryOf(state, R0), En = entryOf(state, Rn)
  const links = [...R0.links]
  for (const l of Rn.links) if (!links.some((x) => x.prev === l.prev && x.next === l.next)) links.push(l)
  const firstVerified = R0.firstVerified === null ? Rn.firstVerified : Rn.firstVerified === null ? R0.firstVerified
    : BigInt(Rn.firstVerified) < BigInt(R0.firstVerified) ? Rn.firstVerified : R0.firstVerified
  const chain: Relationship = {
    ...R0,
    tuples: [...R0.tuples.map((x) => (x.ownPairLabel === prior ? discardAssemblies({ ...x, deactivated: true }) : x)), t],
    activeHead: label,
    earliestAnchor: earlierAnchor(state, R0.earliestAnchor, Rn.earliestAnchor),
    links,
    bindings: unionBindings(R0.bindings, Rn.bindings),
    heldCounterpartHead: Rn.heldCounterpartHead ?? R0.heldCounterpartHead,
    memory: { ...Rn.memory, ...R0.memory },
    firstVerified,
  }
  const husk: Relationship = {
    ...Rn, tuples: [], chainedInto: R0.id, links: [], bindings: {}, earliestAnchor: null, heldCounterpartHead: null, memory: {},
  }
  // the chain takes the fresh relationship's place in the creation order of active heads (2180)
  const heads = state.entryOrder.heads.filter((id) => id !== R0.id).map((id) => (id === Rn.id ? R0.id : id))
  // the fresh relationship's continuity duties move to the chain; the
  // class and re-issue duties of both are relocated below, once the entry
  // that takes the chain's verifications is known
  const duties: HolderState['duties'] = {}
  for (const [id, d] of Object.entries(state.duties)) {
    const relId = (d as { relId?: unknown }).relId
    if (relId !== Rn.id || d.kind === 'merge') { duties[id] = d; continue }
    if (d.kind === 'continuity') duties[id] = { ...d, relId: R0.id } as Duty
    else if (d.kind === 'class-on' || d.kind === 'reissue-mapping') duties[id] = d
  }
  const rotations: HolderState['rotations'] = {}
  for (const [id, r] of Object.entries(state.rotations)) {
    if (!Object.hasOwn(r.awaitHead, Rn.id)) { rotations[id] = r; continue }
    const { [Rn.id]: _, ...awaitHead } = r.awaitHead
    rotations[id] = { ...r, awaitHead }
  }
  let next: HolderState = {
    ...state, relationships: { ...state.relationships, [R0.id]: chain, [Rn.id]: husk }, duties, rotations,
    entryOrder: { ...state.entryOrder, heads },
  }
  // the entries (2145, 2140)
  const swap = (c: Contact): Contact => ({ ...c, relIds: [...new Set(c.relIds.map((id) => (id === Rn.id ? R0.id : id)))] })
  let entryId: string
  const out: Duty[] = []
  const renames: IdentityRename[] = []
  if (!Eo || !En || Eo.id === En.id) {
    const e = (Eo ?? En)!
    entryId = e.id
    next = { ...next, contacts: { ...next.contacts, [e.id]: swap(next.contacts[e.id]) } }
  } else if (Eo.pos !== null && En.pos !== null) {
    // 2145: the chain stands behind both entries; the appended tuple's takes its verifications
    entryId = En.id
    next = { ...next, contacts: { ...next.contacts, [En.id]: swap(next.contacts[En.id]) } }
  } else {
    // one entry or none: the other contact folds into it as an alias (2160 settings)
    const survivor = Eo.pos === null && En.pos !== null ? En : Eo
    const gone = survivor === Eo ? En : Eo
    next = { ...next, contacts: { ...next.contacts, [En.id]: swap(next.contacts[En.id]) } }
    const m = mergeInto(next, next.contacts[survivor.id], survivor.id, [next.contacts[gone.id]], bound)
    next = m.state
    out.push(...(m.duties ?? []))
    renames.push(...(m.renames ?? []))
    entryId = m.survivor
  }
  next = withTuple(next, label, (x) => ({ ...x, entryId }))
  next = relocateDuties(next, [R0.id, Rn.id], R0.id, entryId)
  // 6980, 6985: the anchor mapping on the new head, from the chain's earliest anchor (2285)
  const entry = next.contacts[entryId]
  if (classOnToward(entry, 'anchorMapping')) {
    const anchors = new Set([...issuedUnder(R0), ...issuedUnder(Rn)])
    const differ = issuedUnder(R0).length > 0 && issuedUnder(Rn).length > 0 && anchors.size > 1
    if (t.mappingOut.body === null || differ) out.push(...classOnDuty(next, entryId, R0.id, out))
  }
  out.push(...afterChain(next, R0.id))
  // 2145: a merge the two entries admit runs after this commit (2230)
  out.push(...mergeDutiesAfter(state, next, R0.id, { net: false }))
  return { state: next, events: [{ type: 'contact.chained', contactId: entryId, from: Rn.id, into: R0.id }], duties: out, renames }
}

// ── issuing a continuity mapping (6880, 6300) ──────────────────────────

/** A continuity mapping prepared on the fresh tuple `label` naming the
 *  own anchor of tuple `prior`. */
interface Issue {
  label: string
  prior: string
  baseRev: Dec
  rev: Dec
  body: ContinuityMappingBody
  proof: ContinuityMapping['proof']
  outbound: OutboundDraft
}

/** Seal a continuity-mapping/0.1 document on tuple `t`. */
async function mappingDocument (ctx: PrepareCtx, t: Readonly<Tuple>, contactId: string, own: string, m: ContinuityMapping): Promise<OutboundDraft> {
  const S = ctx.crypto.subtle
  const threadId = ctx.entropy.id('thread.id')
  const doc = { id: ctx.entropy.id('doc.id'), type: CONTINUITY_MAPPING_TYPE, issuer: own, recipient: t.counterpartAnchor, threadId, issuedAt: iso(ctx.when), payload: m as unknown as Json }
  const envelope = await seal(doc, t.counterpartKeyAgreement, { ephSeed: ctx.entropy.bytes('seal.eph', 32), nonce: ctx.entropy.bytes('seal.nonce', 12) }, S)
  return { digest: await digestDoc(doc, S), envelope, type: CONTINUITY_MAPPING_TYPE, threadId, recipient: { contactId, rkid: t.rkid, keyAgreement: t.counterpartKeyAgreement } }
}

/** Prepare the next revision of the tuple's continuity mapping naming `prior` (6300). */
async function prepareIssue (ctx: PrepareCtx, label: string, prior: string): Promise<Issue | null> {
  const st = ctx.snapshot
  const at = tupleByLabel(st, label)
  const pr = tupleByLabel(st, prior)
  if (!at || !pr) return null
  const t = at.tuple
  const rev = inc(t.continuityOut.rev)
  if (BigInt(rev) > ADMISSION_BOUND) return null                                  // the scope suspends (2.1, 6870)
  const shNew = await pairShared(ctx, t)
  const shPrior = await pairShared(ctx, pr.tuple)
  if (!shNew || !shPrior) return null
  const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor
  const body: ContinuityMappingBody = {
    type: 'continuity-mapping@1', prior: (await ctx.keys.anchorOf(pr.tuple.ownPairLabel)).anchor, next: own, to: t.counterpartAnchor,
    revision: rev, issuedAt: iso(ctx.when),
  }
  const m = await assembleContinuityMapping(body, shPrior, shNew, ctx.crypto.subtle)
  const contactId = entryOf(st, at.rel)?.id ?? at.rel.contactId
  return { label, prior, baseRev: t.continuityOut.rev, rev, body, proof: m.proof, outbound: await mappingDocument(ctx, t, contactId, own, m) }
}

/** Commit an issuance on the state it lands on: revision and body in one
 *  step (6300), the recipient's current entry; null where the scope moved. */
function commitIssue (state: HolderState, p: Issue, set: (o: ContinuityOut) => Partial<ContinuityOut>): { state: HolderState, outbound: OutboundDraft } | null {
  const at = tupleByLabel(state, p.label)
  if (!at || at.tuple.continuityOut.rev !== p.baseRev) return null
  const next = withTuple(state, p.label, (t) => ({
    ...t,
    continuityOut: { ...t.continuityOut, rev: p.rev, body: p.body as unknown as Json, proof: p.proof as unknown as Json, sent: [p.outbound.digest], due: null, ...set(t.continuityOut) },
  }))
  const after = tupleByLabel(next, p.label)!
  const contactId = entryOf(next, after.rel)?.id ?? p.outbound.recipient.contactId
  return { state: next, outbound: { ...p.outbound, recipient: { ...p.outbound.recipient, contactId } } }
}

/** The standing mapping duty of the tuple (6840, 6850), in the state:
 *  opened (or restarted) at an issuance; its first run schedules the
 *  resend after the backoff. */
const openMapping = (state: HolderState, label: string, relId: string): HolderState =>
  ({ ...state, duties: { ...state.duties, [mappingDutyId(label)]: { kind: 'continuity', v: 1, id: mappingDutyId(label), relId, tuple: label, step: 'mapping', attempt: 1 } } })

/** The standing duty made due now (a failure, 6830/6840): opened if absent. */
const dueNow = (state: HolderState, d: ContinuityDuty, when: Millis): HolderState => {
  const cur = Object.hasOwn(state.duties, d.id) ? state.duties[d.id] as ContinuityDuty : d
  return { ...state, duties: { ...state.duties, [d.id]: { ...cur, dueAt: when } } }
}

const dropDuty = (state: HolderState, id: string): HolderState => {
  if (!Object.hasOwn(state.duties, id)) return state
  const { [id]: _, ...duties } = state.duties
  return { ...state, duties }
}

/**
 * The record side's choice (6900): the first prepared prior still
 * chainable is chained atomically with its issuance; where none was
 * prepared but some match is still chainable, the choice is owed (due).
 */
function choose (state: HolderState, label: string, matches: readonly string[], issues: readonly Issue[], bound: bigint): Applied {
  for (const p of issues) {
    if (!chainable(state, label, p.prior)) continue
    const c = chainTuple(state, label, p.prior, bound)
    if (typeof c === 'string') continue
    const i = commitIssue(c.state, p, () => ({ chosen: p.prior }))
    if (!i) continue
    const after = tupleByLabel(i.state, label)!
    return { state: openMapping(i.state, label, after.rel.id), outbound: [i.outbound], events: c.events, duties: c.duties, renames: c.renames }
  }
  const viable = matches.filter((m) => chainable(state, label, m))
  // every candidate gone: an owed choice dies, honestly unchained (6990)
  if (!viable.length) return { state: withTuple(state, label, (t) => (t.continuityOut.due?.kind === 'choice' ? { ...t, continuityOut: { ...t.continuityOut, due: null } } : t)) }
  const at = tupleByLabel(state, label)!
  const s = withTuple(state, label, (t) => ({ ...t, continuityOut: { ...t.continuityOut, due: { kind: 'choice', prior: viable[0], alts: viable.slice(1) } } }))
  return { state: owe(s, label, at.rel.id) }
}

/** A production owed: the mapping duty, due at once. */
const owe = (state: HolderState, label: string, relId: string): HolderState => {
  const id = mappingDutyId(label)
  const fresh: ContinuityDuty = { kind: 'continuity', v: 1, id, relId, tuple: label, step: 'mapping' }
  const { dueAt: _, ...cur } = (Object.hasOwn(state.duties, id) ? state.duties[id] : fresh) as ContinuityDuty
  return { ...state, duties: { ...state.duties, [id]: cur } }
}

/** The non-record side's match report or alignment (6930): issued, or owed. */
function issueOrOwe (state: HolderState, label: string, prior: string, issue: Issue | null, kind: 'report' | 'align'): Applied {
  const at = tupleByLabel(state, label)!
  const i = issue && issue.prior === prior ? commitIssue(state, issue, () => ({ reported: prior, aligned: false })) : null
  if (i) return { state: openMapping(i.state, label, at.rel.id), outbound: [i.outbound] }
  const s = withTuple(state, label, (t) => ({ ...t, continuityOut: { ...t.continuityOut, due: { kind, prior } } }))
  return { state: owe(s, label, at.rel.id) }
}

const merge = (a: Applied, b: Applied): Applied => ({
  state: b.state,
  outbound: [...(a.outbound ?? []), ...(b.outbound ?? [])],
  events: [...(a.events ?? []), ...(b.events ?? [])],
  duties: [...(a.duties ?? []), ...(b.duties ?? [])],
  renames: [...(a.renames ?? []), ...(b.renames ?? [])],
})

// ── the probe sender (6a.2, 6830) ──────────────────────────────────────

interface ProbeIssue { label: string, baseSeq: Dec, seq: Dec, outbound: OutboundDraft[] }

async function prepareProbe (ctx: PrepareCtx, label: string): Promise<ProbeIssue | null> {
  const st = ctx.snapshot
  const at = liveHead(st, label)
  if (!at || !probeOwed(st, at.tuple)) return null
  const t = at.tuple
  const seq = inc(t.probeOut.seq)
  if (BigInt(seq) > ADMISSION_BOUND) return null                                  // 6680, the scope suspends
  const shared = await pairShared(ctx, t)
  if (!shared) return null
  const S = ctx.crypto.subtle
  const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor
  // 6730, 6740: the own pair anchors of the prior-candidate set, never the fresh tuple's
  const priors: string[] = []
  for (const pc of t.priorCandidates) if (pc.ownPairLabel !== t.ownPairLabel) priors.push((await ctx.keys.anchorOf(pc.ownPairLabel)).anchor)
  const k = await probeKeyOf(shared, own, t.counterpartAnchor, S)
  const chunks = await buildProbeChunks(k, seq, priors.filter((a) => a !== own), () => ctx.entropy.bytes('pad', 32), S)
  // one probe = one thread (Delivery §4.4)
  const threadId = ctx.entropy.id('thread.id')
  const contactId = entryOf(st, at.rel)?.id ?? at.rel.contactId
  const outbound: OutboundDraft[] = []
  for (const c of chunks) outbound.push(await chunkDocument(ctx, CONTINUITY_PROBE_TYPE, own, t, contactId, threadId, c as unknown as Json))
  return { label, baseSeq: t.probeOut.seq, seq, outbound }
}

// ── the duty (6830–6850) ───────────────────────────────────────────────

type MappingWork =
  | { kind: 'choice', baseRev: Dec, issues: Issue[] }
  | { kind: 'report' | 'align', baseRev: Dec, issue: Issue | null }
  | { kind: 'resend', baseRev: Dec, outbound: OutboundDraft }

async function prepareMappingWork (ctx: PrepareCtx, label: string): Promise<MappingWork | null> {
  const st = ctx.snapshot
  const at = liveHead(st, label)
  if (!at) return null
  const t = at.tuple
  const o = t.continuityOut
  if (o.due?.kind === 'choice') {
    const issues: Issue[] = []
    for (const p of [o.due.prior, ...o.due.alts]) {
      if (!chainable(st, label, p)) continue
      const i = await prepareIssue(ctx, label, p)
      if (i) issues.push(i)
    }
    return { kind: 'choice', baseRev: o.rev, issues }
  }
  if (o.due) return { kind: o.due.kind, baseRev: o.rev, issue: await prepareIssue(ctx, label, o.due.prior) }
  if (o.body === null || o.proof === null) return null
  // 6840: the same artifact under the same revision, in a new document
  const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor
  const m = { body: o.body, proof: o.proof } as unknown as ContinuityMapping
  return { kind: 'resend', baseRev: o.rev, outbound: await mappingDocument(ctx, t, entryOf(st, at.rel)?.id ?? at.rel.contactId, own, m) }
}

function continuityDuty (bound: bigint): DutyHandler<ProbeIssue | MappingWork | null> {
  return {
    v: 1,
    prepare: (ctx, duty) => {
      const d = duty as ContinuityDuty
      return d.step === 'probe' ? prepareProbe(ctx, d.tuple) : prepareMappingWork(ctx, d.tuple)
    },
    apply (state, duty, ctx, when): Applied | Refusal | 'not-due' {
      const d = duty as ContinuityDuty
      const at = liveHead(state, d.tuple)
      if (!at) return { state: state as HolderState }                              // per-tuple duties die with the tuple (6250)
      const t = at.tuple
      const p = ctx.prepared.value
      const attempt = d.attempt ?? 0
      // the standing duty stays, due again after the backoff (6830, 6840)
      const again = (n: number): ContinuityDuty => {
        const { dueAt: _, ...rest } = d
        return { ...rest, relId: at.rel.id, attempt: n, dueAt: Math.min(when + Math.max(0, Math.ceil(ctx.backoff(Math.max(1, n)))), Number.MAX_SAFE_INTEGER) }
      }
      if (d.step === 'probe') {
        if (!probeOwed(state, t)) return { state: state as HolderState }
        const q = p as ProbeIssue | null
        if (q === null) return { ok: false, code: BigInt(t.probeOut.seq) >= ADMISSION_BOUND ? 'scope-exhausted' : 'no-own-channel' }
        if (t.probeOut.seq !== q.baseSeq) return 'not-due'
        // 6680: the sequence and the outbox in one commit, before the send;
        // every send is a fresh probe (6710), never the outbox's reproduction
        const inflight: Tuple['probeOut']['inflight'] = {}
        for (const [s, f] of Object.entries(t.probeOut.inflight)) if (f.digests.some((x) => Object.hasOwn(state.outbox, x))) inflight[s] = f
        inflight[q.seq] = { digests: q.outbound.map((o) => o.digest), acked: [] }
        return {
          state: withTuple(state, d.tuple, (x) => ({ ...x, probeOut: { ...x.probeOut, seq: q.seq, inflight } })),
          outbound: q.outbound, duties: [again(attempt + 1)],
        }
      }
      const w = p as MappingWork | null
      const o = t.continuityOut
      if (w === null) return o.due || issuanceStands(t, recordOf(t) ?? false) ? { ok: false, code: 'no-own-channel' } : { state: state as HolderState }
      if (o.rev !== w.baseRev) return 'not-due'
      if (w.kind === 'choice') {
        if (o.chosen !== null || o.due?.kind !== 'choice') return { state: withTuple(state, d.tuple, (x) => ({ ...x, continuityOut: { ...x.continuityOut, due: null } })) }
        const r = choose(state as HolderState, d.tuple, [o.due.prior, ...o.due.alts], w.issues, bound)
        if (r.outbound?.length) return { ...r, duties: [...(r.duties ?? []), again(1)] }
        // still owed (no key for any candidate): the duty stays; else every candidate is gone
        return tupleByLabel(r.state, d.tuple)!.tuple.continuityOut.due ? { ok: false, code: 'no-own-channel' } : { state: r.state }
      }
      if (w.kind === 'report' || w.kind === 'align') {
        if (o.due?.kind !== w.kind) return { state: state as HolderState }
        // 6860: a match report after the record side's choice is never sent
        if (w.kind === 'report' && t.continuityIn.recordPrior !== null) return { state: withTuple(state, d.tuple, (x) => ({ ...x, continuityOut: { ...x.continuityOut, due: null } })) }
        if (!w.issue) return { ok: false, code: 'no-own-channel' }
        const i = commitIssue(state as HolderState, w.issue, () => ({ reported: w.issue!.prior, aligned: false }))
        return i ? { state: i.state, outbound: [i.outbound], duties: [again(1)] } : 'not-due'
      }
      // the resend (6840): while the issuance stands, after the backoff,
      // unless a document of it is still with the outbox
      const record = recordOf(t)
      if (record === null || !issuanceStands(t, record)) return { state: state as HolderState }
      if (d.dueAt === undefined || o.sent.some((x) => pending(state, x))) return { state: state as HolderState, duties: [again(Math.max(1, attempt))] }
      const resend = (w as Extract<MappingWork, { kind: 'resend' }>).outbound
      return {
        state: withTuple(state, d.tuple, (x) => ({ ...x, continuityOut: { ...x.continuityOut, sent: [...x.continuityOut.sent, resend.digest] } })),
        outbound: [resend], duties: [again(attempt + 1)],
      }
    },
  }
}

const delivered = (state: Readonly<HolderState>, digest: string): boolean =>
  Object.hasOwn(state.outbox, digest) && triasOf(state.outbox[digest]) === 'delivered'

/** Still with the outbox: neither delivered nor failed. */
const pending = (state: Readonly<HolderState>, digest: string): boolean =>
  Object.hasOwn(state.outbox, digest) && triasOf(state.outbox[digest]) !== 'delivered' && triasOf(state.outbox[digest]) !== 'failed'

// ── acks and failures ──────────────────────────────────────────────────

/** A probe's chunks all acked: the probe completed and the duty ends (6830). */
const probeAck: AckHandler = (state, ref) => {
  const at = tupleByRkid(state, state.outbox[ref].recipient.rkid)
  if (!at) return { state: state as HolderState }
  const o = at.tuple.probeOut
  const hit = Object.entries(o.inflight).find(([, f]) => f.digests.includes(ref))
  if (!hit) return { state: state as HolderState }
  const [seq, f] = hit
  const acked = f.acked.includes(ref) ? f.acked : [...f.acked, ref]
  const done = f.digests.every((x) => acked.includes(x))
  const next = withTuple(state, at.tuple.ownPairLabel, (t) => ({
    ...t, probeOut: done ? { ...t.probeOut, inflight: {}, done: true } : { ...t.probeOut, inflight: { ...t.probeOut.inflight, [seq]: { ...f, acked } } },
  }))
  return { state: done ? dropDuty(next, probeDutyId(at.tuple.ownPairLabel)) : next }
}

/** A failed probe chunk: the fresh probe is due at once (6710, 6830). */
const probeFailed: FailureHandler = (state, ref, when) => {
  const at = tupleByRkid(state, state.outbox[ref].recipient.rkid)
  if (!at || !liveHead(state, at.tuple.ownPairLabel) || !probeOwed(state, at.tuple)) return { state: state as HolderState }
  const label = at.tuple.ownPairLabel
  return { state: dueNow(state as HolderState, { kind: 'continuity', v: 1, id: probeDutyId(label), relId: at.rel.id, tuple: label, step: 'probe' }, when) }
}

/** The alignment delivered: its duty ends (6850). */
const mappingAck: AckHandler = (state, ref) => {
  const at = tupleByRkid(state, state.outbox[ref].recipient.rkid)
  if (!at || !at.tuple.continuityOut.sent.includes(ref)) return { state: state as HolderState }
  const t = at.tuple
  const rp = t.continuityIn.recordPrior
  if (rp === null || t.continuityOut.reported !== priorOf(t, rp)?.ownPairLabel) return { state: state as HolderState }
  const next = withTuple(state, t.ownPairLabel, (x) => ({ ...x, continuityOut: { ...x.continuityOut, aligned: true } }))
  return { state: t.continuityOut.due ? next : dropDuty(next, mappingDutyId(t.ownPairLabel)) }
}

/** A failed mapping that still stands: the resend is due at once (6840). */
const mappingFailed: FailureHandler = (state, ref, when) => {
  const at = tupleByRkid(state, state.outbox[ref].recipient.rkid)
  if (!at || !liveHead(state, at.tuple.ownPairLabel)) return { state: state as HolderState }
  const t = at.tuple
  const record = recordOf(t)
  if (!t.continuityOut.sent.includes(ref) || record === null || !issuanceStands(t, record)) return { state: state as HolderState }
  if (t.continuityOut.sent.some((x) => pending(state, x))) return { state: state as HolderState }
  const label = t.ownPairLabel
  return { state: dueNow(state as HolderState, { kind: 'continuity', v: 1, id: mappingDutyId(label), relId: at.rel.id, tuple: label, step: 'mapping', attempt: 1 }, when) }
}

// ── reception: continuity-probe/0.1 (6a.2) ─────────────────────────────

type ProbePlan =
  | { kind: 'repeat' }
  | { kind: 'hold', label: string, assembly: NonNullable<Tuple['probeIn']['assembly']> }
  | { kind: 'discard', label: string, probe: Dec, reason: 'resource-limit' | 'rejected', ref: string }
  | { kind: 'complete', label: string, probe: Dec, matches: string[], record: boolean, issues: Issue[] }

const maxDec = (a: Dec, b: Dec): Dec => (BigInt(a) >= BigInt(b) ? a : b)

function probeTask (bound: bigint, limit: number): TaskHandler<ProbeChunk, ProbePlan> {
  return {
    proof: 'absent',
    // stage 7: the closed chunk schema, exactly 256 entries (6670)
    decode: (payload) => (probeChunkOk(payload) ? payload as ProbeChunk : refuse('malformed', 'RLTP-TRU-6670')),
    async prepare (ctx, doc, arrival) {
      if ((doc.ceremony as { enactment?: unknown } | undefined)?.enactment !== undefined) return refuse('validation-failed')
      const st = ctx.snapshot
      const at = arrivalTuple(st, arrival.rkid)
      if (!at) return refuse('validation-failed', 'RLTP-TRU-6240')
      const t = at.tuple
      const body = doc.payload.body
      const probe = BigInt(body.probe)
      if (probe <= BigInt(t.probeIn.hwm)) return refuse('validation-failed', 'RLTP-TRU-6700')
      if (probe <= BigInt(t.probeIn.lowerBound)) return refuse('validation-failed', 'RLTP-TRU-5366')
      if (t.probeIn.assembly && probe < BigInt(t.probeIn.assembly.salt)) return refuse('validation-failed', 'RLTP-TRU-5340')
      const shared = await pairShared(ctx, t)
      if (!shared) return refuse('validation-failed', 'RLTP-TRU-6670')
      const S = ctx.crypto.subtle
      const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor
      // k_p of the sender's direction (6720)
      const k = await probeKeyOf(shared, t.counterpartAnchor, own, S)
      if (!(await probeChunkMacOk(k, doc.payload, S))) return refuse('validation-failed', 'RLTP-TRU-6670')
      const label = t.ownPairLabel
      const step = assemblyStep(t.probeIn.assembly, body.probe, body as unknown as { seq: Dec, last: boolean } & Record<string, Json>, doc.threadId, arrival.digest, limit)
      if (step.kind === 'limit') return { kind: 'discard', label, probe: body.probe, reason: 'resource-limit', ref: 'RLTP-TRU-5365' }
      if (step.kind === 'repeat') return { kind: 'repeat' }
      if (step.kind === 'reject') return { kind: 'discard', label, probe: body.probe, reason: 'rejected', ref: step.ref }
      if (step.kind === 'hold') return { kind: 'hold', label, assembly: step.assembly }
      const union = assembledBodies(step.chunks, step.last).flatMap((b) => b.blinded as string[])
      if (union.length !== Number(step.last) * PROBE_CHUNK || !strictlyAscending(union)) return { kind: 'discard', label, probe: body.probe, reason: 'rejected', ref: 'RLTP-TRU-6760' }
      // 6800: the counterpart anchors of the own prior-candidate set, never the fresh tuple's
      const inUnion = new Set(union)
      const matches: string[] = []
      for (const pc of t.priorCandidates) {
        if (pc.ownPairLabel === label || pc.counterpartAnchor === t.counterpartAnchor) continue
        if (inUnion.has(await blindPrior(k, pc.counterpartAnchor, S))) matches.push(pc.ownPairLabel)
      }
      const record = isRecordSide(own, t.counterpartAnchor)
      const issues: Issue[] = []
      const o = t.continuityOut
      if (matches.length && record && o.chosen === null) {
        for (const m of matches) {
          if (!chainable(st, label, m)) continue
          const i = await prepareIssue(ctx, label, m)
          if (i) issues.push(i)
        }
      } else if (matches.length && !record && o.reported === null && t.continuityIn.recordPrior === null) {
        const m = matches.find((x) => chainable(st, label, x)) ?? matches[0]
        const i = await prepareIssue(ctx, label, m)
        if (i) issues.push(i)
      }
      return { kind: 'complete', label, probe: body.probe, matches, record, issues }
    },
    apply (state, prepared): Applied | TaskDiscarded {
      const p = prepared.value
      if (p.kind === 'repeat') return { state: state as HolderState }
      if (p.kind === 'hold') return { state: withTuple(state, p.label, (t) => ({ ...t, probeIn: { ...t.probeIn, assembly: p.assembly } })) }
      if (p.kind === 'discard') {
        // 5365, 5366: the assembly dropped, its probe the lower bound; the completed one stays
        return { discarded: true, reason: p.reason, ref: p.ref, state: withTuple(state, p.label, (t) => ({ ...t, probeIn: { ...t.probeIn, assembly: null, lowerBound: maxDec(t.probeIn.lowerBound, p.probe) } })) }
      }
      // 6690: the highest completed probe, in the completing chunk's commit
      let next = withTuple(state, p.label, (t) => ({ ...t, probeIn: { ...t.probeIn, hwm: p.probe, assembly: null } }))
      if (!p.matches.length) return { state: next }                                 // 6260: honestly a new relationship
      const t = tupleByLabel(next, p.label)!.tuple
      if (p.record) {
        if (t.continuityOut.chosen !== null) return { state: next }
        return choose(next, p.label, p.matches, p.issues, bound)
      }
      if (t.continuityOut.reported !== null || t.continuityIn.recordPrior !== null) return { state: next }
      const m = p.issues[0]?.prior ?? p.matches.find((x) => chainable(next, p.label, x)) ?? p.matches[0]
      return issueOrOwe(next, p.label, m, p.issues[0] ?? null, 'report')
    },
  }
}

// ── reception: continuity-mapping/0.1 (6a.4) ───────────────────────────

interface MappingPlan {
  label: string
  /** the prior tuple the mapping's `prior` names (6960) */
  prior: string
  /** the sender is the record side (2290) */
  senderRecord: boolean
  /** the own anchor of the prior tuple: what an aligned mapping names */
  ownPrior: string
  /** the issuance the verification triggers: the alignment (non-record)
   *  or the choice the match report informs (record) */
  issue: Issue | null
  /** where an earlier report of the non-record side already names the
   *  record-chosen relationship: that report again, under its revision,
   *  as the answer (6930, 6840) */
  answer: OutboundDraft | null
}

function mappingTask (bound: bigint): TaskHandler<ContinuityMapping, MappingPlan> {
  return {
    proof: 'absent',
    // step 1 (6940): the schema and a calendar-valid issuedAt
    decode: (payload) => (continuityMappingOk(payload) ? payload as ContinuityMapping : refuse('malformed', 'RLTP-TRU-6940')),
    async prepare (ctx, doc, arrival) {
      if ((doc.ceremony as { enactment?: unknown } | undefined)?.enactment !== undefined) return refuse('validation-failed')
      const st = ctx.snapshot
      const at = arrivalTuple(st, arrival.rkid)
      if (!at) return refuse('validation-failed', 'RLTP-TRU-6240')
      const t = at.tuple
      const b = doc.payload.body
      const own = (await ctx.keys.anchorOf(t.ownPairLabel)).anchor
      // steps 2 and 3 (6950): the tuple it arrived on
      if (b.to !== own || b.next !== t.counterpartAnchor) return refuse('validation-failed', 'RLTP-TRU-6950')
      // step 4 (6960): prior in the frozen prior-candidate set (6200)
      const pc = priorOf(t, b.prior)
      const pr = pc && tupleByLabel(st, pc.ownPairLabel)
      if (!pc || !pr) return refuse('validation-failed', 'RLTP-TRU-6960')
      // step 5 (6970): both secrets non-zero, mac1 under the prior relationship's, mac2 under the new
      const shNew = await pairShared(ctx, t)
      const shPrior = await pairShared(ctx, pr.tuple)
      if (!shNew || !shPrior || !(await continuityMacsOk(doc.payload, shPrior, shNew, ctx.crypto.subtle))) return refuse('validation-failed', 'RLTP-TRU-6970')
      const senderRecord = isRecordSide(b.next, own)
      const ownPrior = (await ctx.keys.anchorOf(pc.ownPairLabel)).anchor
      const o = t.continuityOut
      let issue: Issue | null = null
      if (senderRecord && o.reported !== pc.ownPairLabel) issue = await prepareIssue(ctx, t.ownPairLabel, pc.ownPairLabel)
      if (!senderRecord && o.chosen === null && chainable(st, t.ownPairLabel, pc.ownPairLabel)) issue = await prepareIssue(ctx, t.ownPairLabel, pc.ownPairLabel)
      let answer: OutboundDraft | null = null
      if (senderRecord && o.reported === pc.ownPairLabel && !o.aligned && o.body !== null && o.proof !== null) {
        answer = await mappingDocument(ctx, t, entryOf(st, at.rel)?.id ?? at.rel.contactId, own, { body: o.body, proof: o.proof } as unknown as ContinuityMapping)
      }
      return { label: t.ownPairLabel, prior: pc.ownPairLabel, senderRecord, ownPrior, issue, answer }
    },
    // step 6 (6970): the revision rule with the record freeze, and what follows
    apply (state, prepared, doc, arrival): Applied | TaskRefusal {
      const at = arrivalTuple(state, arrival.rkid)
      if (!at) return refuse('validation-failed', 'RLTP-TRU-6240')
      const p = prepared.value
      const t = at.tuple
      const b = doc.payload.body
      const rev = BigInt(b.revision)
      const cur = BigInt(t.continuityIn.rev)
      if (rev === cur) {
        // a repeat is ignored (6270); another body under it an equivocation
        if (t.continuityIn.body === null || jcs(b) !== jcs(t.continuityIn.body)) return refuse('validation-failed', 'RLTP-TRU-6270')
        // a report on the chosen relationship, again after the choice: the answer (6840)
        if (!p.senderRecord && t.continuityOut.chosen === p.prior && !t.continuityOut.aligned) return { state: answered(state as HolderState, p.label) }
        return { state: state as HolderState }
      }
      if (rev < cur) return refuse('validation-failed', 'RLTP-TRU-6270')
      if (p.senderRecord && t.continuityIn.recordPrior !== null && t.continuityIn.recordPrior !== b.prior) return refuse('validation-failed', 'RLTP-TRU-6290')
      let next = withTuple(state, p.label, (x) => ({
        ...x, continuityIn: { rev: b.revision, body: b as unknown as Json, recordPrior: p.senderRecord ? b.prior : x.continuityIn.recordPrior },
      }))
      if (p.senderRecord) {
        // 6900: the non-record side chains on verifying the record side's mapping
        const c = chainTuple(next, p.label, p.prior, bound)
        if (c === 'taken') return refuse('validation-failed', 'RLTP-TRU-6900')
        let out: Applied = { state: next }
        if (c !== 'already') out = { state: c.state, events: c.events, duties: c.duties, renames: c.renames }
        next = out.state
        // 6850: the report duty ends; the alignment arises in its place (6930)
        const x = tupleByLabel(next, p.label)!.tuple
        if (x.continuityOut.due?.kind === 'report') next = withTuple(next, p.label, (y) => ({ ...y, continuityOut: { ...y.continuityOut, due: null } }))
        if (x.continuityOut.reported === p.prior) {
          // the earlier report names the chosen relationship: sent again as
          // the answer, under its revision; its delivery ends the duty (6850)
          if (x.continuityOut.aligned || !p.answer) return { ...out, state: next }
          next = withTuple(next, p.label, (y) => ({ ...y, continuityOut: { ...y.continuityOut, sent: [...y.continuityOut.sent, p.answer!.digest] } }))
          const contactId = entryOf(next, tupleByLabel(next, p.label)!.rel)?.id ?? p.answer.recipient.contactId
          return merge(out, { state: openMapping(next, p.label, tupleByLabel(next, p.label)!.rel.id), outbound: [{ ...p.answer, recipient: { ...p.answer.recipient, contactId } }] })
        }
        return merge(out, issueOrOwe(next, p.label, p.prior, p.issue, 'align'))
      }
      // a match report (6910, 6920): it informs the choice, never chains by itself
      const x = tupleByLabel(next, p.label)!.tuple
      if (x.continuityOut.chosen === null) return choose(next, p.label, [p.prior], p.issue ? [p.issue] : [], bound)
      // the counterpart's mapping on the chosen relationship answers the choice (6840)
      if (x.continuityOut.chosen === p.prior) next = answered(next, p.label)
      return { state: next }
    },
  }
}

/** The record side's choice answered: its standing duty ends (6840). */
const answered = (state: HolderState, label: string): HolderState =>
  dropDuty(withTuple(state, label, (y) => ({ ...y, continuityOut: { ...y.continuityOut, aligned: true } })), mappingDutyId(label))

// ── the module's parts ─────────────────────────────────────────────────

/** What trustModule registers for continuity. */
export function continuityParts (bound: bigint, limit: number): Pick<HolderModule, 'tasks' | 'duties' | 'acks' | 'failures' | 'ownRetries' | 'keepKeys'> {
  return {
    ownRetries: [CONTINUITY_PROBE_TYPE],
    keepKeys: continuityKeys,
    tasks: { [CONTINUITY_PROBE_TYPE]: probeTask(bound, limit), [CONTINUITY_MAPPING_TYPE]: mappingTask(bound) },
    duties: { continuity: continuityDuty(bound) },
    acks: { [CONTINUITY_PROBE_TYPE]: probeAck, [CONTINUITY_MAPPING_TYPE]: mappingAck },
    failures: { [CONTINUITY_PROBE_TYPE]: probeFailed, [CONTINUITY_MAPPING_TYPE]: mappingFailed },
  }
}

/**
 * The testing module (./testing): its non-human command continuity.newTuple
 * opens a fresh tuple the way the encounter will (PR 7), with the rkid
 * the KeyProvider derives for its label.
 */
export const continuityTestModule: HolderModule = Object.freeze({
  name: 'continuity-test',
  commands: Object.freeze({
    [NEW_TUPLE]: {
      human: false,
      prepare: async (ctx: PrepareCtx, input: NewTupleInput) => (await ctx.keys.anchorOf(input.ownPairLabel)).keyAgreement,
      apply: (state: Readonly<HolderState>, prepared: { value: string }, input: NewTupleInput, when: Millis) => openTuple(state, input, prepared.value, when),
    } satisfies CommandDef<NewTupleInput, string>,
  }),
})
