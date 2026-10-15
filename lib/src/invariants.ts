// invariants — predicates over one holder state and over one commit
// (before, after), for tests and an optional runtime check (lib Stage 2,
// note §4.7). createHolder(ports, {invariants: true}) runs them on every
// commit, before the store's CAS, and throws InfraError
// 'invariant-violated' with the violations as its cause: a violating
// state never lands. A testing mode, not a production guard; the property
// generator (test/invariants.test.mjs) checks them after every step.
//
// Rule numbers: bare four-digit numbers are RLTP-TRU (trust-layer.md);
// Identity §n is identity-layer.md, Delivery §n delivery-contract.md.
//
// Over one state (stateViolations):
//   entries     every tuple's entryId names a contact or an alias (2145);
//               every contact's relIds exist, are distinct, are no husks;
//               every relationship's contactId resolves (2090, 2140);
//               an id or alias names one contact only, never itself as an
//               alias (2140); every live relationship belongs to the entry
//               its identity resolves to, and to at most one other, the
//               entry its active tuple feeds (2145); a position exactly
//               where the status is not `none` (2060, 2250); the matches
//               of an accepted star name contacts (6160);
//               entry positions are distinct and below nextPos (2120);
//               entryOrder.heads names each live relationship once (2180)
//   head        an entry all of whose relationships feed it holds as its
//               anchor head one of their newest heads, none where they
//               hold none (6560)
//   bindings    every binding list is non-empty, sorted and distinct; two
//               bindings for one anchor are the flagged conflict of a
//               chaining's union (6610); two links from one prev to
//               different nexts only beside such a flag
//   salts       per tuple and reconciled artifact: every in-flight salt in
//               [1, lastSalt], hwm ≤ lastSalt, snapshot and its digest
//               present together (5630, 5660, 5690); probe sequences
//               likewise (6680)
//   assembly    an open assembly's salt lies above both the completed hwm
//               and the lower bound (5150, 5366); an accepted star or group
//               star carries the hwm as its salt
//   duties      a class duty (class-on, reissue-mapping, profile) is owed
//               on an existing relationship that is no husk, under the
//               entry its verifications go to, whose class is on (6410,
//               2790: the drop rule holds); a class-on duty has its
//               deterministic id (trust/duties.ts)
//
// Over one commit (transitionViolations):
//   commitSeq   strictly +1 per commit; lastWhen never falls (4.7)
//   register    labels, pair nonces, carriers, device names and revocation
//               marks only grow; the community keeps its genesis and its
//               head never falls; the lineage only extends (Identity §2)
//   addresses   tombstones never shrink; a key leaves only as a tombstone
//               (Delivery §5)
//   salts       per tuple label: lastSalt, probe seq and the issued
//               revisions never fall, exhausted is sticky, a new in-flight
//               salt is above the old lastSalt (a salt is never issued
//               twice, 5110); hwm and lowerBound never fall (5140, 5366)
//   bindings    a second binding for one anchor arises only where a
//               chaining appended a tuple in this commit (6610, the union of
//               4c); a relationship's held anchor head moves only along the
//               links it holds (6150, 6170), except at such a chaining
//   outbox      `accepted` appears only through report; a new item starts
//               submitted (Delivery §6.1, note §4.3)
//   effects     a new cache entry only through a unique receive, one, the
//               document's digest; entries leave only by tick (Delivery
//               4.2)
//   duties      a duty disappears only where a rule lets it (dutyDrops):
//                 resume        any (fulfilment, a merge duty that no
//                               longer holds, a continuity flow's end)
//                 receive       continuity (the flow's end by its ack)
//                 any commit    a class duty whose relationship left or is
//                               a husk now (departure, the move at a
//                               chaining) or whose class is off toward the
//                               entry it is owed under (6410, 2790); a
//                               continuity duty whose relationship left
//               a duty of a kind the library does not know never leaves
//   journal     act records leave only by tick (retention)
//
// Choices where the brief and the note leave them open (PR 5):
//   - "effects holds only completed digests" is read as: an entry enters
//     only with the stage-9 commit of a unique receive. A chunk held in an
//     open assembly is such a completed effect (every chunk is acked on
//     its own, Delivery 4.2, 5.2a), so "no effect digest in an open
//     assembly" would contradict the per-chunk ack; it is not checked
//   - "lowerBound ≥ hwm when set" does not hold: a discard raises the lower
//     bound to a salt above hwm, and a later, higher salt completing
//     raises hwm past it (5140, 5366). Checked instead: both never fall,
//     and an open assembly lies above both
import { jcs } from './core.js'
import { triasOf } from './state.js'
import type { Contact, Duty, HolderState, Relationship, SeqIn, SeqOut, Tuple } from './state.js'
import { ADMISSION_BOUND, classOnToward, entryOf, entryRelationships, feeding, findContact, liveRel, newestHeads, newestOf } from './trust/state.js'
import { classOfDuty, classOnId } from './trust/duties.js'

/** What a commit was: the operation that produced it. */
export type CommitOp =
  | { kind: 'act', command: string }
  | { kind: 'tick' }
  | { kind: 'resume' }
  | { kind: 'report', status?: string }
  | { kind: 'receive', disposition?: string, digest?: string }

/** One broken invariant: its name (as in the header) and what broke it. */
export interface Violation { invariant: string, detail: string }

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const big = (d: string): bigint => BigInt(d)
const isHusk = (r: Readonly<Relationship>): boolean => r.chainedInto !== null

// ── one state ──────────────────────────────────────────────────────────

function seqOutViolations (v: Violation[], where: string, o: Readonly<SeqOut<unknown>>): void {
  const last = big(o.lastSalt)
  for (const salt of Object.keys(o.inflight)) {
    if (big(salt) < 1n || big(salt) > last) v.push({ invariant: 'salts', detail: `${where}: in-flight salt ${salt} outside [1, lastSalt ${o.lastSalt}]` })
  }
  if (big(o.hwm) > last) v.push({ invariant: 'salts', detail: `${where}: hwm ${o.hwm} above lastSalt ${o.lastSalt}` })
  if ((o.snapshot === null) !== (o.snapshotDigest === null)) v.push({ invariant: 'salts', detail: `${where}: snapshot and snapshotDigest not together` })
  if (o.exhausted && last < ADMISSION_BOUND) v.push({ invariant: 'salts', detail: `${where}: exhausted below the bound` })
}

function seqInViolations (v: Violation[], where: string, i: Readonly<SeqIn<{ salt: string } | unknown>>, accepted: boolean): void {
  if (i.assembly !== null) {
    const s = big(i.assembly.salt)
    if (s <= big(i.hwm) || s <= big(i.lowerBound)) v.push({ invariant: 'assembly', detail: `${where}: open assembly at salt ${i.assembly.salt} not above hwm ${i.hwm} and lowerBound ${i.lowerBound}` })
  }
  if (accepted && i.accepted !== null && (i.accepted as { salt: string }).salt !== i.hwm) {
    v.push({ invariant: 'assembly', detail: `${where}: accepted salt ${(i.accepted as { salt: string }).salt} is not hwm ${i.hwm}` })
  }
}

function tupleViolations (v: Violation[], state: Readonly<HolderState>, r: Readonly<Relationship>, t: Readonly<Tuple>): void {
  const where = `${r.id}/${t.ownPairLabel}`
  if (!findContact(state, t.entryId)) v.push({ invariant: 'entries', detail: `${where}: entryId ${t.entryId} names no contact` })
  seqOutViolations(v, `${where} starOut`, t.starOut)
  seqOutViolations(v, `${where} groupStarOut`, t.groupStarOut)
  for (const p of Object.keys(t.probeOut.inflight)) {
    if (big(p) < 1n || big(p) > big(t.probeOut.seq)) v.push({ invariant: 'salts', detail: `${where}: probe ${p} outside [1, seq ${t.probeOut.seq}]` })
  }
  seqInViolations(v, `${where} starIn`, t.starIn, true)
  seqInViolations(v, `${where} groupStarIn`, t.groupStarIn, true)
  seqInViolations(v, `${where} probeIn`, { ...t.probeIn, accepted: null }, false)
}

function dutyViolations (v: Violation[], state: Readonly<HolderState>, d: Readonly<Duty>): void {
  const cls = classOfDuty(d as Duty)
  if (cls === null) return
  const relId = (d as { relId: string }).relId
  if (d.kind === 'class-on' && d.id !== classOnId(cls, relId)) v.push({ invariant: 'duties', detail: `${d.id}: a class-on duty's id is ${classOnId(cls, relId)}` })
  if (!Object.hasOwn(state.relationships, relId) || isHusk(state.relationships[relId])) {
    v.push({ invariant: 'duties', detail: `${d.id}: owed on ${relId}, which is gone or a husk` })
    return
  }
  const e = entryOf(state, state.relationships[relId])
  const named = findContact(state, (d as { contactId: string }).contactId)
  if (!e || !named || named.id !== e.id) v.push({ invariant: 'duties', detail: `${d.id}: owed under ${(d as { contactId: string }).contactId}, not the entry ${e?.id} its relationship's verifications go to` })
  else if (!classOnToward(e, cls)) v.push({ invariant: 'duties', detail: `${d.id}: the class ${cls} is off toward ${e.id} (6410)` })
}

/** The invariants of one state (see the header); empty where all hold. */
export function stateViolations (state: Readonly<HolderState>): Violation[] {
  const v: Violation[] = []
  const contacts = Object.values(state.contacts)
  const positions = new Set<string>()
  for (const c of contacts) {
    if (!c.relIds.length || new Set(c.relIds).size !== c.relIds.length) v.push({ invariant: 'entries', detail: `${c.id}: relIds ${jcs(c.relIds)} empty or repeated` })
    for (const id of c.relIds) {
      if (!Object.hasOwn(state.relationships, id)) v.push({ invariant: 'entries', detail: `${c.id}: relationship ${id} does not exist` })
      else if (isHusk(state.relationships[id])) v.push({ invariant: 'entries', detail: `${c.id}: relationship ${id} is a husk` })
    }
    if (c.pos !== null) {
      if (positions.has(c.pos)) v.push({ invariant: 'entries', detail: `${c.id}: position ${c.pos} taken twice` })
      positions.add(c.pos)
      if (big(c.pos) >= big(state.entryOrder.nextPos)) v.push({ invariant: 'entries', detail: `${c.id}: position ${c.pos} not below nextPos ${state.entryOrder.nextPos}` })
    }
    headViolations(v, state, c)
  }
  const names = new Map<string, string>()
  for (const c of contacts) {
    if ((c.pos === null) !== (c.status === 'none')) v.push({ invariant: 'entries', detail: `${c.id}: position ${c.pos} with status ${c.status}` })
    for (const n of [c.id, ...c.aliases]) {
      if (names.has(n)) v.push({ invariant: 'entries', detail: `${n} names ${names.get(n)} and ${c.id}` })
      names.set(n, c.id)
    }
  }
  for (const r of Object.values(state.relationships)) {
    if (!findContact(state, r.contactId)) v.push({ invariant: 'entries', detail: `${r.id}: contactId ${r.contactId} resolves to no contact` })
    if (!isHusk(r)) {
      const holders = contacts.filter((c) => c.relIds.includes(r.id)).map((c) => c.id)
      const own = findContact(state, r.contactId)?.id
      const fed = entryOf(state, r)?.id
      const ok = own !== undefined && holders.includes(own) && holders.every((h) => h === own || h === fed) && (fed === undefined || holders.includes(fed))
      if (!ok) v.push({ invariant: 'entries', detail: `${r.id}: held by ${jcs(holders)}, its identity resolves to ${own}, its active tuple feeds ${fed}` })
    }
    for (const t of r.tuples) {
      for (const m of t.starIn.accepted?.matches ?? []) if (!findContact(state, m)) v.push({ invariant: 'entries', detail: `${r.id}/${t.ownPairLabel}: an accepted star matches ${m}, no contact` })
    }
    for (const t of r.tuples) tupleViolations(v, state, r, t)
    for (const [anchor, list] of Object.entries(r.bindings)) {
      if (!list.length || jcs(list) !== jcs([...new Set(list)].sort(cmp))) v.push({ invariant: 'bindings', detail: `${r.id}: bindings of ${anchor} not a sorted, distinct, non-empty list` })
    }
    for (const l of r.links) {
      if (r.links.some((m) => m.prev === l.prev && m.next !== l.next) && !((r.bindings[l.prev]?.length ?? 0) > 1)) {
        v.push({ invariant: 'bindings', detail: `${r.id}: links from ${l.prev} to different nexts without a flagged binding conflict` })
        break
      }
    }
  }
  const heads = state.entryOrder.heads
  if (new Set(heads).size !== heads.length) v.push({ invariant: 'entries', detail: 'entryOrder.heads repeats a relationship' })
  for (const id of heads) if (!Object.hasOwn(state.relationships, id) || isHusk(state.relationships[id])) v.push({ invariant: 'entries', detail: `entryOrder.heads names ${id}, gone or a husk` })
  for (const r of Object.values(state.relationships)) if (liveRel(r) && !heads.includes(r.id)) v.push({ invariant: 'entries', detail: `${r.id} is live but not in entryOrder.heads` })
  for (const d of Object.values(state.duties)) dutyViolations(v, state, d)
  return v
}

/** 6560 for an entry all of whose relationships feed it. */
function headViolations (v: Violation[], state: Readonly<HolderState>, c: Readonly<Contact>): void {
  const all = entryRelationships(state, c)
  const rels = feeding(state, c)
  if (all.length !== rels.length || all.length !== c.relIds.length) return
  const newest = newestHeads(rels)
  if (!newest.length ? c.anchorHead !== null : (c.anchorHead === null || !newest.includes(c.anchorHead))) {
    v.push({ invariant: 'head', detail: `${c.id}: anchor head ${c.anchorHead} is not among the newest heads ${jcs(newest)} of its relationships` })
  }
}

// ── one commit ─────────────────────────────────────────────────────────

const superset = (after: readonly string[], before: readonly string[]): string[] => {
  const a = new Set(after)
  return before.filter((x) => !a.has(x))
}

/** Every tuple by its own pair label (labels are unique per holder). */
const tuplesByLabel = (state: Readonly<HolderState>): Map<string, Tuple> => {
  const m = new Map<string, Tuple>()
  for (const r of Object.values(state.relationships)) for (const t of r.tuples) m.set(t.ownPairLabel, t)
  return m
}

/** Whether a rule lets duty `d` of `before` be gone after the commit `op` (see the header). */
export function dutyDrops (before: Readonly<HolderState>, after: Readonly<HolderState>, d: Readonly<Duty>, op: CommitOp): boolean {
  if (op.kind === 'resume') return true
  const relId = (d as { relId?: unknown }).relId
  const relGone = typeof relId === 'string' && (!Object.hasOwn(after.relationships, relId) || isHusk(after.relationships[relId]))
  if (d.kind === 'continuity') return relGone || op.kind === 'receive'
  const cls = classOfDuty(d as Duty)
  if (cls === null) return false
  if (relGone) return true
  const e = entryOf(after, after.relationships[relId as string])
  return e !== undefined && !classOnToward(e, cls)
}

function seqOutTransition (v: Violation[], where: string, b: Readonly<SeqOut<unknown>>, a: Readonly<SeqOut<unknown>>): void {
  if (big(a.lastSalt) < big(b.lastSalt)) v.push({ invariant: 'salts', detail: `${where}: lastSalt fell ${b.lastSalt} → ${a.lastSalt}` })
  if (b.exhausted && !a.exhausted) v.push({ invariant: 'salts', detail: `${where}: exhausted is sticky` })
  if (big(a.hwm) < big(b.hwm)) v.push({ invariant: 'salts', detail: `${where}: hwm fell ${b.hwm} → ${a.hwm}` })
  for (const s of Object.keys(a.inflight)) {
    if (!Object.hasOwn(b.inflight, s) && big(s) <= big(b.lastSalt)) v.push({ invariant: 'salts', detail: `${where}: salt ${s} issued again (lastSalt was ${b.lastSalt})` })
  }
}

function seqInTransition (v: Violation[], where: string, b: Readonly<{ hwm: string, lowerBound: string }>, a: Readonly<{ hwm: string, lowerBound: string }>): void {
  if (big(a.hwm) < big(b.hwm)) v.push({ invariant: 'salts', detail: `${where}: received hwm fell ${b.hwm} → ${a.hwm}` })
  if (big(a.lowerBound) < big(b.lowerBound)) v.push({ invariant: 'salts', detail: `${where}: lowerBound fell ${b.lowerBound} → ${a.lowerBound}` })
}

/** The invariants of one commit from `before` to `after` by `op` (see the header). */
export function transitionViolations (before: Readonly<HolderState>, after: Readonly<HolderState>, op: CommitOp): Violation[] {
  const v: Violation[] = []
  if (big(after.commitSeq) !== big(before.commitSeq) + 1n) v.push({ invariant: 'commitSeq', detail: `commitSeq ${before.commitSeq} → ${after.commitSeq}` })
  if (after.lastWhen < before.lastWhen) v.push({ invariant: 'commitSeq', detail: `lastWhen fell ${before.lastWhen} → ${after.lastWhen}` })
  // the register (Identity §2): monotone sets
  const rb = before.register, ra = after.register
  const lost = (what: string, xs: string[]): void => { if (xs.length) v.push({ invariant: 'register', detail: `${what} lost ${jcs(xs)}` }) }
  lost('labels', superset(ra.labels, rb.labels))
  lost('pairNonces', Object.keys(rb.pairNonces).filter((k) => ra.pairNonces[k] !== rb.pairNonces[k]))
  for (const [k, list] of Object.entries(rb.carriers)) lost(`carriers ${k}`, superset((ra.carriers[k] ?? []).map((x) => jcs(x)), list.map((x) => jcs(x))))
  lost('device names', superset(ra.devices.names, rb.devices.names))
  lost('device revocations', superset(ra.devices.revoked, rb.devices.revoked))
  if (rb.community !== null && (ra.community === null || ra.community.genesis !== rb.community.genesis || big(ra.community.head) < big(rb.community.head))) {
    v.push({ invariant: 'register', detail: 'the community lost its genesis or its head fell' })
  }
  if (ra.lineage.length < rb.lineage.length || jcs(ra.lineage.slice(0, rb.lineage.length)) !== jcs(rb.lineage)) v.push({ invariant: 'register', detail: 'the lineage did not only extend' })
  // addresses (Delivery §5)
  lost('tombstones', superset(after.addresses.tombstones, before.addresses.tombstones))
  for (const k of Object.keys(before.addresses.keys)) {
    if (!Object.hasOwn(after.addresses.keys, k) && !after.addresses.tombstones.includes(k)) v.push({ invariant: 'addresses', detail: `${k} left without a tombstone` })
  }
  // salts and revisions, per tuple label
  const tb = tuplesByLabel(before)
  for (const [label, a] of tuplesByLabel(after)) {
    const b = tb.get(label)
    if (!b) continue
    seqOutTransition(v, `${label} starOut`, b.starOut, a.starOut)
    seqOutTransition(v, `${label} groupStarOut`, b.groupStarOut, a.groupStarOut)
    seqInTransition(v, `${label} starIn`, b.starIn, a.starIn)
    seqInTransition(v, `${label} groupStarIn`, b.groupStarIn, a.groupStarIn)
    seqInTransition(v, `${label} probeIn`, b.probeIn, a.probeIn)
    if (big(a.probeOut.seq) < big(b.probeOut.seq)) v.push({ invariant: 'salts', detail: `${label}: probe seq fell` })
    if (big(a.mappingOut.rev) < big(b.mappingOut.rev)) v.push({ invariant: 'salts', detail: `${label}: mapping revision fell` })
    if (big(a.continuityOut.rev) < big(b.continuityOut.rev)) v.push({ invariant: 'salts', detail: `${label}: continuity revision fell` })
  }
  // bindings and held heads, per relationship (6610, 6150)
  for (const [id, a] of Object.entries(after.relationships)) {
    if (!Object.hasOwn(before.relationships, id) || isHusk(a)) continue
    const b = before.relationships[id]
    const chained = a.tuples.length > b.tuples.length
    if (chained) continue
    for (const [anchor, list] of Object.entries(a.bindings)) {
      if (list.length > 1 && list.length > (b.bindings[anchor]?.length ?? 0)) v.push({ invariant: 'bindings', detail: `${id}: a second binding for ${anchor} without a chaining` })
    }
    if (b.heldCounterpartHead !== null && a.heldCounterpartHead !== b.heldCounterpartHead &&
      (a.heldCounterpartHead === null || jcs(newestOf([b.heldCounterpartHead, a.heldCounterpartHead], a.links)) !== jcs([a.heldCounterpartHead]))) {
      v.push({ invariant: 'bindings', detail: `${id}: the held head moved ${b.heldCounterpartHead} → ${a.heldCounterpartHead} off its links` })
    }
  }
  // the outbox (Delivery §6.1)
  for (const [digest, it] of Object.entries(after.outbox)) {
    const was = Object.hasOwn(before.outbox, digest) ? before.outbox[digest] : undefined
    if (!was) {
      if (it.history.length !== 1 || it.history[0].status !== 'submitted') v.push({ invariant: 'outbox', detail: `${digest}: a new item starts submitted` })
      continue
    }
    const n = (x: typeof it): number => x.history.filter((s) => s.status === 'accepted').length
    if (n(it) > n(was) && op.kind !== 'report') v.push({ invariant: 'outbox', detail: `${digest}: accepted without a report (${op.kind})` })
    if (triasOf(was) === 'delivered' && triasOf(it) !== 'delivered') v.push({ invariant: 'outbox', detail: `${digest}: stepped back from delivered` })
  }
  // the effect cache (Delivery 4.2)
  const added = Object.keys(after.effects).filter((d) => !Object.hasOwn(before.effects, d))
  if (added.length && !(op.kind === 'receive' && op.disposition === 'unique' && added.length === 1 && (op.digest === undefined || added[0] === op.digest))) {
    v.push({ invariant: 'effects', detail: `${jcs(added)} entered the cache by ${op.kind}${op.kind === 'receive' ? ` (${op.disposition})` : ''}` })
  }
  if (op.kind !== 'tick') {
    const gone = Object.keys(before.effects).filter((d) => !Object.hasOwn(after.effects, d))
    if (gone.length) v.push({ invariant: 'effects', detail: `${jcs(gone)} left the cache by ${op.kind}` })
    const acts = Object.keys(before.acts).filter((a) => !Object.hasOwn(after.acts, a))
    if (acts.length) v.push({ invariant: 'journal', detail: `${jcs(acts)} left the journal by ${op.kind}` })
  }
  // duties
  for (const d of Object.values(before.duties)) {
    if (!Object.hasOwn(after.duties, d.id) && !dutyDrops(before, after, d, op)) v.push({ invariant: 'duties', detail: `${d.id} (${d.kind}) disappeared by ${op.kind}${op.kind === 'act' ? ' ' + op.command : ''} without a rule` })
  }
  return v
}

/** Both: the commit's invariants and those of the state it leaves. */
export const commitViolations = (before: Readonly<HolderState>, after: Readonly<HolderState>, op: CommitOp): Violation[] =>
  [...transitionViolations(before, after, op), ...stateViolations(after)]
