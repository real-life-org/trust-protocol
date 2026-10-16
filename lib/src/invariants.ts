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
//   register    every revocation mark names a held device name; the
//               lineage is chained (each prev the preceding next) and no
//               longer than the head allows; at most one rotation runs,
//               from the head to the next generation, its label persisted
//               (6360), its step-2 duty open; a rotation duty names a
//               running rotation (Identity §5.4, §5.5)
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
//   encounter   no challenge both open and recorded (5220); challenge and
//               record labels in the register (4110); a scanner's record
//               holds its credential (5630), a pending counter document its
//               credential (5770); an encounter-confirm prompt names a record
//   groups      the own member anchor on a held roster, its label in the
//               register; no evidence for a member already admitted
//   introductions  a mediator completes only with ack, reply forwarded and
//               vouchers sent (8360); completed, consented and vouched hold
//               a reply; forwarded holds the target pin (8270)
//   owed        a duty class on for a live relationship (2850, 6595) with
//               an artifact to send has it out or owed there: the anchor
//               mapping issued on the active tuple or a class-on or
//               re-issue duty open on it; the profile (once one exists)
//               issued at the counter's revision on the active tuple
//               (profileOut) or a class-on or profile duty open on it
//
// Over one commit (transitionViolations):
//   commitSeq   strictly +1 per commit; lastWhen never falls (4.7)
//   register    labels, pair nonces, carriers, device names and revocation
//               marks only grow; the community keeps its genesis and its
//               head never falls; the lineage only extends (Identity §2); a
//               device.added of an act never names a name revoked before
//               (§5.5); names and marks are sets (a state check); the head
//               moves one generation at a time, with exactly one lineage
//               element, onto a label persisted in an earlier commit (6360)
//   profile     the own profile's one counter never falls and its content
//               changes only with it (6450)
//   addresses   tombstones never shrink; a key leaves only as a tombstone,
//               a member key (group/…, an identity context) excepted
//               (Delivery §5)
//   salts       per tuple label: lastSalt, probe seq and the issued
//               revisions never fall, exhausted is sticky, a new in-flight
//               salt is above the old lastSalt (a salt is never issued
//               twice, 5110) with the digest of its view; what a salt or
//               probe committed (view, viewDigest, digests) never changes,
//               only acked grows within its digests (5130; a rename may
//               rewrite the star's members, 2100); an entry leaves only
//               completed at or below hwm, or with no document left in the
//               outbox; hwm and lowerBound never fall (5140, 5366)
//   baseline    hwm, snapshot and snapshotDigest change only together,
//               upward, by the delivery-ack that completes the in-flight
//               entry of the new hwm, to that entry's view (5660, 5670,
//               5680; star and group star); a rename rewrites the star
//               baseline's members only. The probe's done is sticky and
//               set only by the ack completing a probe (6830)
//   tuples      a tuple new in this commit carries fresh per-tuple state:
//               every salt, revision and sequence at 0, no baseline,
//               assembly, in-flight entry or verified artifact (6250)
//   positions   a position once assigned stays with its entry (2120,
//               2190; after a split with what remains of it, 2080, 2100):
//               it leaves only with the entry, merged into one at an
//               earlier position or departed, and is never assigned again;
//               nextPos never falls; entryOrder.heads only appends, a
//               departed relationship leaving it and a chaining moving the
//               chain into the appended relationship's place (2180)
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
//               (a) fulfilment: resume ran its handler and the handler
//                   returned Applied in this commit (CommitOp.fulfilled)
//               (b) the drop rules: a class duty whose class is off toward
//                   the entry its relationship's verifications go to (6410,
//                   2790; a split's 2115 included), any known duty whose
//                   relationship departed or became a husk (2260, the move
//                   at a chaining)
//               (c) the merge into one of its kind owed on the same
//                   relationship with its urgency kept: a re-issue into one
//                   no later and not waiting where it was due (awaitHead
//                   null wins, 6596), a profile duty into one of no lower
//                   revision
//               (d) the same delivery: an anchor mapping issued on the
//                   relationship in this commit meets every class-on and
//                   re-issue of the anchor mapping owed there (6596); a
//                   profile issued there (its revision rose on the active
//                   tuple, or a profile duty owed there was fulfilled)
//                   meets every class-on and profile duty owed there
//               (e) a received document that ends its continuity step: a
//                   probe duty by the ack that completes an in-flight probe
//                   (done set in this commit, 6830); a mapping duty by its
//                   current issuance answered (aligned in this commit) —
//                   the ack of one of that issuance's documents, or a
//                   continuity mapping arriving on the tuple (6850)
//               (f) a rotation duty, by its rotation's completion in this
//                   commit (the act's step 2: the head moved, the rotation
//                   gone)
//               expiry: no duty kind expires yet. A duty of a kind (or
//               version) the library does not know leaves only by (a), a
//               module's handler: never where none is registered
//   journal     act records leave only by tick (retention)
//   encounter   records only grow, a credential held in a direction never
//               changes (5.6 step 8, 5660); a challenge leaves only into a
//               record or aged at lastWhen (5290)
//   introductions  an act leaves only past its absolute lifetime (8310)
//   groups      a held group and its roster members stay (removal is not built)
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
import { classOfDuty, classOnId, hasArtifact, onFor, owedOn } from './trust/duties.js'
import { CONTINUITY_MAPPING_TYPE, CONTINUITY_PROBE_TYPE } from './trust/continuity.js'
import { viewDigest } from './trust/star.js'
import { isKnownDuty } from './codec.js'
import type { HolderEvent } from './events.js'
import { communityLabel } from './identity.js'
import { challengeAged } from './encounter.js'
import { ACT_EXPIRY, ACT_SKEW } from './introduction.js'

/** What a commit was: the operation that produced it. */
export type CommitOp =
  /** events: what the act announces (the engine passes them) */
  | { kind: 'act', command: string, events?: readonly HolderEvent[] }
  | { kind: 'tick' }
  /** fulfilled: the duties whose handler returned Applied in this commit */
  | { kind: 'resume', fulfilled?: readonly string[] }
  | { kind: 'report', status?: string }
  /** type: the received document's; ref: the acknowledged outbox digest of
   *  a delivery-ack; rkid: the own key the document arrived on */
  | { kind: 'receive', disposition?: string, digest?: string, type?: string, ref?: string, rkid?: string }

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

/** The register (Identity §2, §5.4, §5.5) and the running rotations. */
function registerViolations (v: Violation[], state: Readonly<HolderState>): void {
  const r = state.register
  for (const n of r.devices.revoked) if (!r.devices.names.includes(n)) v.push({ invariant: 'register', detail: `revocation mark ${n} without its device name` })
  if (new Set(r.devices.names).size !== r.devices.names.length || new Set(r.devices.revoked).size !== r.devices.revoked.length) v.push({ invariant: 'register', detail: 'device names or revocation marks repeat: they are sets' })
  const lin = r.lineage as Array<{ body?: { prev?: unknown, next?: unknown } }>
  for (let i = 1; i < lin.length; i++) if (lin[i].body?.prev !== lin[i - 1].body?.next) v.push({ invariant: 'register', detail: `lineage element ${i} does not continue element ${i - 1}` })
  if (r.community !== null && big(r.community.head) - 1n < BigInt(lin.length)) v.push({ invariant: 'register', detail: `${lin.length} lineage elements beyond head ${r.community.head}` })
  for (const rot of Object.values(state.rotations)) {
    if (r.community === null || big(rot.from) !== big(r.community.head) || big(rot.to) !== big(rot.from) + 1n) v.push({ invariant: 'register', detail: `rotation ${rot.id} ${rot.from} → ${rot.to} does not start at the head ${r.community?.head}` })
    else if (!r.labels.includes(communityLabel(r.community.genesis, Number(rot.to)))) v.push({ invariant: 'register', detail: `rotation ${rot.id}: the label of generation ${rot.to} is not persisted (6360)` })
  }
  if (Object.keys(state.rotations).length > 1) v.push({ invariant: 'register', detail: 'more than one rotation running' })
  // a running rotation has its step-2 duty open, and a rotation duty names a running rotation
  for (const rot of Object.values(state.rotations)) {
    if (!Object.values(state.duties).some((d) => d.kind === 'rotation' && (d as { rotationId?: unknown }).rotationId === rot.id)) v.push({ invariant: 'register', detail: `rotation ${rot.id} has no rotation duty: it would never complete` })
  }
  for (const d of Object.values(state.duties)) {
    if (d.kind === 'rotation' && isKnownDuty(d) && !Object.hasOwn(state.rotations, (d as { rotationId: string }).rotationId)) v.push({ invariant: 'duties', detail: `${d.id}: no rotation ${(d as { rotationId: string }).rotationId} runs` })
  }
}

/** The invariants of one state (see the header); empty where all hold. */
/** The encounter, the groups and the introduction acts (PR 7a). */
function socialViolations (v: Violation[], state: Readonly<HolderState>): void {
  const labels = new Set(state.register.labels)
  const e = state.encounter
  for (const c of Object.values(e.challenges)) {
    if (Object.hasOwn(e.records, c.value)) v.push({ invariant: 'encounter', detail: `challenge ${c.value} both open and recorded (5220)` })
    if (!labels.has(c.label)) v.push({ invariant: 'encounter', detail: `challenge ${c.value}: its label is not in the register (4110)` })
  }
  for (const r of Object.values(e.records)) {
    if (!labels.has(r.label)) v.push({ invariant: 'encounter', detail: `record ${r.own}: its label is not in the register (4110)` })
    if (r.role === 'scanner' && r.out === null) v.push({ invariant: 'encounter', detail: `record ${r.own}: a scanner's record without its step credential (5630)` })
    if (r.counterPending && r.out === null) v.push({ invariant: 'encounter', detail: `record ${r.own}: a counter document pending without the credential (5770)` })
  }
  for (const p of Object.values(state.prompts)) {
    if (p.kind === 'encounter-confirm' && !Object.hasOwn(e.records, p.id.slice('encounter:'.length))) v.push({ invariant: 'encounter', detail: `prompt ${p.id} names no record` })
  }
  for (const g of Object.values(state.groups)) {
    if (g.memberAnchor !== undefined && Object.keys(g.roster).length && !Object.hasOwn(g.roster, g.memberAnchor)) v.push({ invariant: 'groups', detail: `${g.id}: the own member anchor is not on the roster` })
    if (Object.keys(g.roster).length && !labels.has(g.memberLabel)) v.push({ invariant: 'groups', detail: `${g.id}: the member label is not in the register` })
    for (const ev of Object.values(g.evidence)) {
      const subject = (ev.accept as { payload?: { accept?: { subject?: string } } }).payload?.accept?.subject
      if (subject !== undefined && Object.hasOwn(g.roster, subject)) v.push({ invariant: 'groups', detail: `${g.id}: evidence held for a member already admitted` })
    }
  }
  for (const a of Object.values(e.introductions)) {
    if (a.role === 'mediator' && a.status === 'completed' && !(a.ack !== null && a.replyForwarded && a.vouchersSent)) v.push({ invariant: 'introductions', detail: `${a.key}: completed without its three duties (8360)` })
    if (a.vouched !== (a.voucher !== null)) v.push({ invariant: 'introductions', detail: `${a.key}: vouched without its retained voucher, or the reverse (8200)` })
    if ((a.status === 'completed' && a.role === 'requester') || a.status === 'consented' || a.vouched) {
      if (a.reply === null) v.push({ invariant: 'introductions', detail: `${a.key}: ${a.status}${a.vouched ? ', vouched' : ''} without a reply` })
    }
    if (a.role === 'mediator' && a.status === 'forwarded' && a.pins.target === undefined) v.push({ invariant: 'introductions', detail: `${a.key}: forwarded without a target pin (8270)` })
  }
}

export function stateViolations (state: Readonly<HolderState>): Violation[] {
  const v: Violation[] = []
  registerViolations(v, state)
  socialViolations(v, state)
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
  const holdersOf = new Map<string, string[]>()
  for (const c of contacts) for (const id of c.relIds) holdersOf.set(id, [...(holdersOf.get(id) ?? []), c.id])
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
      const holders = holdersOf.get(r.id) ?? []
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
  const headSet = new Set(heads)
  for (const r of Object.values(state.relationships)) if (liveRel(r) && !headSet.has(r.id)) v.push({ invariant: 'entries', detail: `${r.id} is live but not in entryOrder.heads` })
  for (const d of Object.values(state.duties)) dutyViolations(v, state, d)
  // 2850: on for a relationship, out there or owed there
  const duties = Object.values(state.duties)
  for (const r of Object.values(state.relationships)) {
    if (!liveRel(r)) continue
    for (const cls of ['anchorMapping', 'profile'] as const) {
      if (!hasArtifact(state, cls) || !onFor(state, r, cls)) continue
      const head = r.tuples.find((t) => t.ownPairLabel === r.activeHead)!
      const out = cls === 'anchorMapping' ? head.mappingOut.body !== null : head.profileOut.rev === state.profile.revision
      if (!out && !duties.some((d) => owedOn(d, r.id, cls))) v.push({ invariant: 'owed', detail: `${r.id}: the ${cls} class is on for it, nothing is out there and no duty owes it (2850)` })
    }
  }
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

const dueOf = (d: Readonly<Duty>): number => (Number.isSafeInteger(d.dueAt) ? d.dueAt as number : 0)

/** What a tuple new in this commit carries beyond fresh state (6250). */
function freshViolations (t: Readonly<Tuple>): string[] {
  const out: string[] = []
  const seqOutFresh = (o: Readonly<SeqOut<unknown>>): boolean => o.lastSalt === '0' && o.hwm === '0' && !o.exhausted && o.snapshot === null && Object.keys(o.inflight).length === 0
  const seqInFresh = (i: Readonly<{ hwm: string, lowerBound: string, assembly: unknown, accepted?: unknown }>): boolean =>
    i.hwm === '0' && i.lowerBound === '0' && i.assembly === null && (i.accepted ?? null) === null
  if (!seqOutFresh(t.starOut)) out.push('starOut')
  if (!seqOutFresh(t.groupStarOut)) out.push('groupStarOut')
  if (!seqInFresh(t.starIn)) out.push('starIn')
  if (!seqInFresh(t.groupStarIn)) out.push('groupStarIn')
  if (!seqInFresh(t.probeIn)) out.push('probeIn')
  if (t.probeOut.seq !== '0' || Object.keys(t.probeOut.inflight).length || t.probeOut.done) out.push('probeOut')
  if (t.mappingOut.rev !== '0' || t.mappingOut.body !== null) out.push('mappingOut')
  if (t.mappingIn.rev !== '0' || t.mappingIn.body !== null) out.push('mappingIn')
  if (t.continuityOut.rev !== '0' || t.continuityOut.body !== null) out.push('continuityOut')
  if (t.continuityIn.rev !== '0' || t.continuityIn.body !== null) out.push('continuityIn')
  if (t.profileIn.rev !== '0' || t.profileIn.body !== null) out.push('profileIn')
  if (t.profileOut.rev !== '0') out.push('profileOut')
  if (t.deactivated) out.push('deactivated')
  return out
}

/**
 * 2120, 2190: a position once assigned stays with its entry. Every
 * position held before is held after, unless its entry merged into one at
 * an earlier position or left the state; a position new in this commit
 * lies at or above the old nextPos (never reused); nextPos never falls.
 */
function positionViolations (v: Violation[], before: Readonly<HolderState>, after: Readonly<HolderState>): void {
  if (big(after.entryOrder.nextPos) < big(before.entryOrder.nextPos)) v.push({ invariant: 'positions', detail: `nextPos fell ${before.entryOrder.nextPos} → ${after.entryOrder.nextPos}` })
  const holder = new Map(Object.values(after.contacts).filter((c) => c.pos !== null).map((c) => [c.pos as string, c]))
  const had = new Set(Object.values(before.contacts).map((c) => c.pos).filter((p): p is string => p !== null))
  for (const c of Object.values(before.contacts)) {
    if (c.pos === null) continue
    const x = findContact(after, c.id)
    const y = holder.get(c.pos)
    if (y !== undefined) {
      // held by the same entry: the one c.id resolves to, or what remains of
      // c's entry under another identity (2100: a rename; 2080: a split whose
      // leaver took c.id, the remaining relationships keeping the position)
      if (x !== undefined && x !== y && !y.relIds.every((id) => c.relIds.includes(id))) v.push({ invariant: 'positions', detail: `${c.id}: position ${c.pos} moved to ${y.id}` })
      continue
    }
    if (x !== undefined && !(x.pos !== null && big(x.pos) < big(c.pos) && !Object.hasOwn(after.contacts, c.id))) {
      v.push({ invariant: 'positions', detail: `${c.id}: position ${c.pos} changed to ${x.pos}` })
    }
  }
  const held = holder.keys()
  for (const p of held) if (!had.has(p) && big(p) < big(before.entryOrder.nextPos)) v.push({ invariant: 'positions', detail: `position ${p} assigned again (nextPos was ${before.entryOrder.nextPos})` })
}

/**
 * 2180: entryOrder.heads only appends, except that a departed relationship
 * leaves it and a chaining puts the chain in the appended relationship's
 * place (the chain's own place leaves).
 */
function headsViolations (v: Violation[], before: Readonly<HolderState>, after: Readonly<HolderState>): void {
  const into = new Map<string, string>()
  for (const r of Object.values(after.relationships)) {
    if (r.chainedInto !== null && Object.hasOwn(before.relationships, r.id) && before.relationships[r.id].chainedInto === null) into.set(r.id, r.chainedInto)
  }
  const chains = new Set(into.values())
  const inAfter = new Set(after.entryOrder.heads)
  const inBefore = new Set(before.entryOrder.heads)
  const kept = before.entryOrder.heads.filter((id) => !chains.has(id)).map((id) => into.get(id) ?? id).filter((id) => inAfter.has(id))
  const a = after.entryOrder.heads
  const added = a.slice(kept.length)
  if (jcs(a.slice(0, kept.length)) !== jcs(kept) || added.some((id) => inBefore.has(id) && !chains.has(id))) {
    v.push({ invariant: 'positions', detail: `entryOrder.heads ${jcs(before.entryOrder.heads)} → ${jcs(a)} is no append (2180)` })
  }
}

/** Whether a rule lets duty `d` of `before` be gone after the commit `op` (see the header). */
export function dutyDrops (before: Readonly<HolderState>, after: Readonly<HolderState>, d: Readonly<Duty>, op: CommitOp): boolean {
  // (a) a registered handler ran it (only a kind the engine registers runs)
  if (op.kind === 'resume' && (op.fulfilled ?? []).includes(d.id)) return true
  if (!isKnownDuty(d as Duty)) return false                                    // otherwise never, on any operation
  if (d.kind === 'intro-ack') return false                                       // only its handler's run ends it
  // (f) the rotation's step 2 completed in this commit (the act's own path)
  if (d.kind === 'rotation') {
    const id = (d as { rotationId: string }).rotationId
    return !Object.hasOwn(after.rotations, id) && after.register.community !== null && before.register.community !== null &&
      big(after.register.community.head) === big(before.register.community.head) + 1n
  }
  const relId = (d as { relId?: unknown }).relId as string
  const relGone = !Object.hasOwn(after.relationships, relId) || isHusk(after.relationships[relId])
  if (d.kind === 'merge') return false
  if (relGone) return true                                                      // (b) departed, moved
  if (d.kind === 'continuity') {
    // (e) on receive, by the end of its own step only
    if (op.kind !== 'receive') return false
    const label = (d as { tuple: string }).tuple
    const tb = tuplesByLabel(before).get(label), ta = tuplesByLabel(after).get(label)
    if (!tb || !ta) return false
    const ref = op.ref
    if ((d as { step: string }).step === 'probe') {
      // 6830: the ack that completes an in-flight probe, done set in this commit
      if (tb.probeOut.done || !ta.probeOut.done || ref === undefined) return false
      return Object.values(tb.probeOut.inflight).some((e) => e.digests.includes(ref) && e.digests.every((x) => x === ref || e.acked.includes(x)))
    }
    // 6850: the current issuance answered, aligned in this commit — by the
    // ack of one of its own documents, or by a continuity mapping on the tuple
    if (tb.continuityOut.aligned || !ta.continuityOut.aligned) return false
    if (ref !== undefined) return tb.continuityOut.sent.includes(ref) && before.outbox[ref]?.type === CONTINUITY_MAPPING_TYPE
    return op.type === CONTINUITY_MAPPING_TYPE && op.rkid === tb.rkid
  }
  const cls = classOfDuty(d as Duty)
  if (cls === null) return false
  const e = entryOf(after, after.relationships[relId])
  if (e !== undefined && !classOnToward(e, cls)) return true                    // (b) 6410
  // (c) merged into one of its kind on the same relationship, urgency kept
  const same = Object.values(after.duties).filter((x) => x.kind === d.kind && owedOn(x, relId, cls))
  if (d.kind === 'reissue-mapping') {
    const waits = (d as { awaitHead: string | null }).awaitHead
    if (same.some((x) => dueOf(x) <= dueOf(d) && (waits !== null || (x as { awaitHead: string | null }).awaitHead === null))) return true
  }
  if (d.kind === 'profile' && same.some((x) => BigInt((x as { rev: string }).rev) >= BigInt((d as { rev: string }).rev))) return true
  // (d) the profile went out on the relationship in this commit: its
  // revision rose there, or a profile duty owed there was fulfilled
  if (cls === 'profile') {
    const was = before.relationships[relId], now = after.relationships[relId]
    const head = now.tuples.find((x) => x.ownPairLabel === now.activeHead)
    const prior = was?.tuples.find((x) => x.ownPairLabel === now.activeHead)
    if (head && prior && big(head.profileOut.rev) > big(prior.profileOut.rev)) return true
    if (op.kind === 'resume' && (op.fulfilled ?? []).some((id) => Object.hasOwn(before.duties, id) && owedOn(before.duties[id], relId, 'profile'))) return true
  }
  // (d) the anchor mapping went out on the relationship in this commit
  if (cls === 'anchorMapping') {
    const was = before.relationships[relId], now = after.relationships[relId]
    const head = now.tuples.find((x) => x.ownPairLabel === now.activeHead)
    const prior = was?.tuples.find((x) => x.ownPairLabel === now.activeHead)
    if (head && prior && big(head.mappingOut.rev) > big(prior.mappingOut.rev)) return true
  }
  return false
}

/** A star view renamed only (2100, 2140): the same anchor heads, members renamed. */
const renamedOnly = (a: readonly unknown[], b: readonly unknown[]): boolean => {
  const heads = (x: readonly unknown[]): string => jcs(x.map((y) => (y as { head?: unknown }).head ?? null).sort())
  return a.length === b.length && a.every((y) => (y as { head?: unknown }).head !== undefined) && heads(a) === heads(b)
}

/**
 * One reconciled sequence's sender side over a commit (5110, 5130, 5660,
 * 5670, 5680): lastSalt, hwm and exhausted never fall back; a salt is
 * issued once, with a view whose digest is its viewDigest; what was
 * committed under a salt (view, viewDigest, digests) stays — only `acked`
 * grows, within the digests — except that a rename rewrites the members
 * of the star's views (`renames`); an entry leaves only once completed at
 * or below hwm or once none of its documents is in the outbox; the
 * baseline (hwm, snapshot, snapshotDigest) changes only together, upward,
 * by the ack (`ack`) that completes the in-flight entry of the new hwm,
 * to that entry's view.
 */
function seqOutTransition (v: Violation[], where: string, b: Readonly<SeqOut<unknown>>, a: Readonly<SeqOut<unknown>>, after: Readonly<HolderState>, ack: string | undefined, renames: boolean): void {
  if (big(a.lastSalt) < big(b.lastSalt)) v.push({ invariant: 'salts', detail: `${where}: lastSalt fell ${b.lastSalt} → ${a.lastSalt}` })
  if (b.exhausted && !a.exhausted) v.push({ invariant: 'salts', detail: `${where}: exhausted is sticky` })
  if (big(a.hwm) < big(b.hwm)) v.push({ invariant: 'salts', detail: `${where}: hwm fell ${b.hwm} → ${a.hwm}` })
  for (const [s, e] of Object.entries(a.inflight)) {
    const was = Object.hasOwn(b.inflight, s) ? b.inflight[s] : undefined
    if (!was) {
      if (big(s) <= big(b.lastSalt)) v.push({ invariant: 'salts', detail: `${where}: salt ${s} issued again (lastSalt was ${b.lastSalt})` })
      if (e.viewDigest !== viewDigest(e.view)) v.push({ invariant: 'salts', detail: `${where}: salt ${s} issued with a viewDigest not of its view` })
      if (e.acked.length) v.push({ invariant: 'salts', detail: `${where}: salt ${s} issued already acked` })
      continue
    }
    if (jcs(e.digests) !== jcs(was.digests)) v.push({ invariant: 'salts', detail: `${where}: the documents of salt ${s} changed` })
    if (jcs(e.view) !== jcs(was.view) || e.viewDigest !== was.viewDigest) {
      if (!(renames && renamedOnly(e.view, was.view) && e.viewDigest === viewDigest(e.view))) v.push({ invariant: 'salts', detail: `${where}: the view of salt ${s} changed` })
    }
    if (was.acked.some((x) => !e.acked.includes(x)) || e.acked.some((x) => !e.digests.includes(x))) v.push({ invariant: 'salts', detail: `${where}: acked of salt ${s} shrank or left its digests` })
  }
  for (const [s, e] of Object.entries(b.inflight)) {
    if (Object.hasOwn(a.inflight, s)) continue
    if (big(s) > big(a.hwm) && e.digests.some((x) => Object.hasOwn(after.outbox, x))) v.push({ invariant: 'salts', detail: `${where}: salt ${s} left in flight above hwm ${a.hwm} with documents still in the outbox` })
  }
  const baseline = a.hwm !== b.hwm || jcs(a.snapshot) !== jcs(b.snapshot) || a.snapshotDigest !== b.snapshotDigest
  if (!baseline) return
  if (a.hwm === b.hwm) {
    // only a rename rewrites the baseline's members, never its heads (2100)
    if (!(renames && a.snapshot !== null && b.snapshot !== null && renamedOnly(a.snapshot, b.snapshot) && a.snapshotDigest === viewDigest(a.snapshot))) {
      v.push({ invariant: 'baseline', detail: `${where}: the baseline changed at hwm ${a.hwm} without a completion (5670, 5680)` })
    }
    return
  }
  const e = Object.hasOwn(b.inflight, a.hwm) ? b.inflight[a.hwm] : undefined
  if (!e || ack === undefined || !e.digests.includes(ack) || e.digests.some((x) => x !== ack && !e.acked.includes(x))) {
    v.push({ invariant: 'baseline', detail: `${where}: hwm ${b.hwm} → ${a.hwm} without the ack that completes salt ${a.hwm} (5660)` })
  } else if (jcs(a.snapshot) !== jcs(e.view) || a.snapshotDigest !== e.viewDigest) {
    v.push({ invariant: 'baseline', detail: `${where}: the baseline at hwm ${a.hwm} is not the view sent under it (5670)` })
  }
}

/** The probe's sender side over a commit (6680, 6830): seq never falls; a
 *  probe's documents stay, `acked` grows within them; `done` is sticky and
 *  set only by the ack completing an in-flight probe, which empties the
 *  in-flight set; otherwise an entry leaves only with its documents gone
 *  from the outbox. */
function probeTransition (v: Violation[], where: string, b: Readonly<Tuple['probeOut']>, a: Readonly<Tuple['probeOut']>, after: Readonly<HolderState>, ack: string | undefined): void {
  if (big(a.seq) < big(b.seq)) v.push({ invariant: 'salts', detail: `${where}: probe seq fell` })
  if (b.done && !a.done) v.push({ invariant: 'baseline', detail: `${where}: probe done is sticky` })
  const completed = !b.done && a.done
  if (completed && !Object.values(b.inflight).some((e) => ack !== undefined && e.digests.includes(ack) && e.digests.every((x) => x === ack || e.acked.includes(x)))) {
    v.push({ invariant: 'baseline', detail: `${where}: probe done without the ack completing one (6830)` })
  }
  for (const [s, e] of Object.entries(a.inflight)) {
    const was = Object.hasOwn(b.inflight, s) ? b.inflight[s] : undefined
    if (!was) { if (big(s) <= big(b.seq)) v.push({ invariant: 'salts', detail: `${where}: probe ${s} issued again` }); continue }
    if (jcs(e.digests) !== jcs(was.digests)) v.push({ invariant: 'salts', detail: `${where}: the documents of probe ${s} changed` })
    if (was.acked.some((x) => !e.acked.includes(x)) || e.acked.some((x) => !e.digests.includes(x))) v.push({ invariant: 'salts', detail: `${where}: acked of probe ${s} shrank or left its digests` })
  }
  if (completed) return
  for (const [s, e] of Object.entries(b.inflight)) {
    if (!Object.hasOwn(a.inflight, s) && e.digests.some((x) => Object.hasOwn(after.outbox, x))) v.push({ invariant: 'salts', detail: `${where}: probe ${s} left in flight with documents still in the outbox` })
  }
}

function seqInTransition (v: Violation[], where: string, b: Readonly<{ hwm: string, lowerBound: string }>, a: Readonly<{ hwm: string, lowerBound: string }>): void {
  if (big(a.hwm) < big(b.hwm)) v.push({ invariant: 'salts', detail: `${where}: received hwm fell ${b.hwm} → ${a.hwm}` })
  if (big(a.lowerBound) < big(b.lowerBound)) v.push({ invariant: 'salts', detail: `${where}: lowerBound fell ${b.lowerBound} → ${a.lowerBound}` })
}

/** The invariants of one commit from `before` to `after` by `op` (see the header). */
export function transitionViolations (before: Readonly<HolderState>, after: Readonly<HolderState>, op: CommitOp): Violation[] {
  const v: Violation[] = []
  // the encounter (5.3, 5.5, 5.6): records only grow and a credential once
  // held in a direction stays; a challenge leaves only into a record or aged
  for (const [own, r] of Object.entries(before.encounter.records)) {
    const a = after.encounter.records[own]
    if (!a) { v.push({ invariant: 'encounter', detail: `record ${own} removed` }); continue }
    for (const dir of ['in', 'out'] as const) {
      if (r[dir] !== null && (a[dir] === null || a[dir]!.digest !== r[dir]!.digest)) v.push({ invariant: 'encounter', detail: `record ${own}: the ${dir} credential changed (5.6 step 8, 5660)` })
    }
  }
  for (const [value, c] of Object.entries(before.encounter.challenges)) {
    if (Object.hasOwn(after.encounter.challenges, value) || Object.hasOwn(after.encounter.records, value)) continue
    if (!challengeAged(c.tCh, after.lastWhen)) v.push({ invariant: 'encounter', detail: `challenge ${value} left neither recorded nor aged (5290)` })
  }
  // introduction acts leave only past their absolute lifetime (8310)
  for (const [k, a] of Object.entries(before.encounter.introductions)) {
    if (!Object.hasOwn(after.encounter.introductions, k) && after.lastWhen < a.issuedAt + ACT_EXPIRY + ACT_SKEW) v.push({ invariant: 'introductions', detail: `${k} discarded before its lifetime ended` })
  }
  // a member stays on the holder's roster (removal is not built)
  for (const [id, g] of Object.entries(before.groups)) {
    const ga = after.groups[id]
    if (!ga) { v.push({ invariant: 'groups', detail: `group ${id} left` }); continue }
    for (const m of Object.keys(g.roster)) if (!Object.hasOwn(ga.roster, m)) v.push({ invariant: 'groups', detail: `${id}: member ${m} left the roster` })
  }
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
  // a revoked name is never given again (Identity §5.5)
  // a revoked name is never given again (§5.5): no device.added names one
  if (op.kind === 'act') {
    for (const e of op.events ?? []) if (e.type === 'device.added' && rb.devices.revoked.includes(e.name)) v.push({ invariant: 'register', detail: `device name ${e.name} given again after its revocation` })
  }
  // the head moves by one generation at a time, with one lineage element,
  // onto a label persisted in an earlier commit (6360, Identity §5.4)
  if (rb.community !== null && ra.community !== null && ra.community.head !== rb.community.head) {
    const g = big(ra.community.head)
    if (g !== big(rb.community.head) + 1n || ra.lineage.length !== rb.lineage.length + 1) v.push({ invariant: 'register', detail: `the head moved ${rb.community.head} → ${ra.community.head} with ${ra.lineage.length - rb.lineage.length} lineage elements` })
    if (!rb.labels.includes(communityLabel(ra.community.genesis, Number(g)))) v.push({ invariant: 'register', detail: `the head moved to generation ${ra.community.head} whose label was not persisted before (6360)` })
  }
  // the own profile's one counter never falls, and its content changes only with it (6450)
  if (big(after.profile.revision) < big(before.profile.revision)) v.push({ invariant: 'profile', detail: `the profile revision fell ${before.profile.revision} → ${after.profile.revision}` })
  else if (after.profile.revision === before.profile.revision && jcs(after.profile.body) !== jcs(before.profile.body)) v.push({ invariant: 'profile', detail: `the profile changed under revision ${after.profile.revision}` })
  // addresses (Delivery §5)
  lost('tombstones', superset(after.addresses.tombstones, before.addresses.tombstones))
  for (const k of Object.keys(before.addresses.keys)) {
    if (!Object.hasOwn(after.addresses.keys, k) && !after.addresses.tombstones.includes(k) && !before.addresses.keys[k].label.startsWith('group/')) v.push({ invariant: 'addresses', detail: `${k} left without a tombstone` })
  }
  // salts, baselines and revisions, per tuple label; the acked document
  // of a delivery-ack, and whether the operation may rename (2100, 2140)
  const ack = op.kind === 'receive' ? op.ref : undefined
  const renames = op.kind === 'receive' || op.kind === 'resume' || (op.kind === 'act' && (op.command === 'trust.merge' || op.command === 'trust.depart'))
  const tb = tuplesByLabel(before)
  for (const [label, a] of tuplesByLabel(after)) {
    const b = tb.get(label)
    if (!b) continue
    seqOutTransition(v, `${label} starOut`, b.starOut, a.starOut, after, ack, renames)
    seqOutTransition(v, `${label} groupStarOut`, b.groupStarOut, a.groupStarOut, after, ack, false)
    probeTransition(v, `${label} probeOut`, b.probeOut, a.probeOut, after, ack)
    seqInTransition(v, `${label} starIn`, b.starIn, a.starIn)
    seqInTransition(v, `${label} groupStarIn`, b.groupStarIn, a.groupStarIn)
    seqInTransition(v, `${label} probeIn`, b.probeIn, a.probeIn)
    if (big(a.mappingOut.rev) < big(b.mappingOut.rev)) v.push({ invariant: 'salts', detail: `${label}: mapping revision fell` })
    if (big(a.continuityOut.rev) < big(b.continuityOut.rev)) v.push({ invariant: 'salts', detail: `${label}: continuity revision fell` })
    if (big(a.profileOut.rev) < big(b.profileOut.rev)) v.push({ invariant: 'salts', detail: `${label}: profile revision issued fell` })
    if (big(a.profileOut.rev) > big(after.profile.revision)) v.push({ invariant: 'salts', detail: `${label}: profile revision ${a.profileOut.rev} issued above the counter ${after.profile.revision} (6450)` })
    if (big(a.profileIn.rev) < big(b.profileIn.rev)) v.push({ invariant: 'salts', detail: `${label}: the held profile revision fell (6460)` })
  }
  // a new tuple starts with fresh per-tuple state (6250): nothing migrates into it
  for (const r of Object.values(after.relationships)) {
    for (const t of r.tuples) {
      if (tb.has(t.ownPairLabel)) continue
      const stale = freshViolations(t)
      if (stale.length) v.push({ invariant: 'tuples', detail: `${t.ownPairLabel}: a new tuple carries ${stale.join(', ')} (6250)` })
    }
  }
  // entry positions (2120, 2190) and the creation order of active heads (2180)
  positionViolations(v, before, after)
  headsViolations(v, before, after)
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
