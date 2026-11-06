#!/usr/bin/env node
// access/exchange (stage 1 of the group log, rltp design 2026-11): the
// payload schemas of x-access-entry, x-access-sync and x-access-page, the
// answer as a difference in ancestor-first order, page by page; the intake
// with its dispositions, the repair of a missing parent and its reserve,
// the joining buffer, and the forwarding rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, anchorOfEd, cardBody, diSignWith, digestDoc, edFromSeed, inviteCredentialBody, mkOfX, xFromSeed } from '../dist/index.js'

const {
  ENTRY_TYPE, SYNC_TYPE, PAGE_TYPE, REPAIR_MAX, REPAIR_WINDOW, STAGE1_BOUNDS, admit, ancestorFirst, dropHeld, emptyLog, envelopeBytes, exchangePayloadOk, forwards, genesisDigestOf,
  genesisUnsigned, haveOf, intake, isCurrentMember, materialize, opUnsigned, oversize, pageOf, protectedIds, releaseJoining, signEnvelope, signGenesis,
} = access
const S = globalThis.crypto.subtle
const T = '2026-11-06T10:00:00Z'
const LATER = '2026-11-07T10:00:00Z'

async function person (seed) {
  const ed = await edFromSeed(Uint8Array.from({ length: 32 }, () => seed))
  const x = await xFromSeed(Uint8Array.from({ length: 32 }, () => seed + 1))
  const anchor = anchorOfEd(ed.pubRaw)
  const keyAgreement = mkOfX(x.pubRaw)
  const sign = async (bytes) => new Uint8Array(await S.sign({ name: 'Ed25519' }, ed.priv, bytes))
  const card = (name) => diSignWith(anchor, sign, cardBody({ anchor, keyAgreement }, name ? { name } : {}), T, S)
  return { anchor, keyAgreement, sign, signer: { signer: anchor, sign }, card }
}
const uuid = () => globalThis.crypto.randomUUID()

async function founding (founderSeed = 0x10) {
  const founder = await person(founderSeed)
  const groupKey = await edFromSeed(Uint8Array.from({ length: 32 }, () => 0x99 - founderSeed))
  const group = anchorOfEd(groupKey.pubRaw)
  const gk = { signer: group, sign: async (b) => new Uint8Array(await S.sign({ name: 'Ed25519' }, groupKey.priv, b)) }
  const unsigned = await genesisUnsigned({ group, founder: founder.anchor, card: await founder.card('Founder'), serviceIdentity: founder.anchor, contentKey: Uint8Array.from({ length: 32 }, (_, i) => i) }, S)
  const genesis = await signGenesis(unsigned, gk, founder.signer, S)
  const digest = await genesisDigestOf(genesis, S)
  return { founder, group, genesis, digest, log: emptyLog(digest, genesis) }
}

async function admission (f, inviter, invitee, pad) {
  const threadId = uuid()
  const cred = inviteCredentialBody({ issuer: inviter.anchor, invitee: invitee.anchor, group: f.group, genesisDigest: f.digest, card: await inviter.card('Inviter'), validFrom: T, validUntil: LATER, taskContext: threadId })
  const invite = await diSignWith(inviter.anchor, inviter.sign, cred, T, S)
  const inviteDoc = { id: uuid(), type: 'https://real-life.org/trust-tasks/spec/membership-invite/0.2', issuer: inviter.anchor, recipient: invitee.anchor, threadId, issuedAt: T, payload: { invite } }
  const acceptBody = { id: uuid(), type: 'https://real-life.org/trust-tasks/spec/membership-accept/0.2', issuer: invitee.anchor, recipient: inviter.anchor, threadId, issuedAt: T, payload: { accept: { group: f.group, subject: invitee.anchor, ref: await digestDoc(invite, S), card: await invitee.card(pad ?? 'Invitee'), candidacy: true } } }
  const accept = await diSignWith(invitee.anchor, invitee.sign, acceptBody, T, S)
  return { invite: inviteDoc, accept, welcome: await digestDoc({ welcome: threadId }, S) }
}

/** the member.add a member authors at its replica's position (prev = heads) */
async function add (f, log, inviter, invitee, pad) {
  const m = await materialize(log, S)
  return signEnvelope(opUnsigned(log, m, 'member.add', inviter.anchor, { subject: invitee.anchor, admission: await admission(f, inviter, invitee, pad) }), [inviter.signer], S)
}
async function leave (log, who) {
  return signEnvelope(opUnsigned(log, await materialize(log, S), 'member.leave', who.anchor, {}), [who.signer], S)
}
const replica = (log) => ({ log, repairs: {} })
const take = async (r, entries, source, extra = {}) => intake(r, entries, { source, now: 1_000, ...extra }, S)
/** authors at a replica: the own operation is applied there */
async function authored (r, env) {
  const i = await take(r, [env], 'self')
  assert.deepEqual(i.verdicts.map((v) => v.kind), ['applied'])
  return i.replica
}
const members = async (r) => (await materialize(r.log, S)).members

/** a group of the founder and `n` members it admitted one after another; returns the people and the full log */
async function chain (n) {
  const f = await founding()
  const people = []
  let r = replica(f.log)
  const ops = []
  for (let i = 0; i < n; i++) {
    const p = await person(0x20 + 2 * i)
    const op = await add(f, r.log, f.founder, p)
    r = await authored(r, op)
    people.push(p)
    ops.push(op)
  }
  return { f, people, ops, r }
}

test('the payload schemas: the three types validate their forms and refuse anything else (S1-23, malformed)', async () => {
  const { f, ops } = await chain(1)
  const head = { group: f.group, genesisDigest: f.digest }
  assert.ok(exchangePayloadOk(ENTRY_TYPE, { ...head, entry: ops[0] }))
  assert.ok(exchangePayloadOk(SYNC_TYPE, { ...head, have: [f.genesis.id] }))
  assert.ok(exchangePayloadOk(SYNC_TYPE, { ...head, have: [], want: [ops[0].id], cursor: ops[0].id }))
  assert.ok(exchangePayloadOk(PAGE_TYPE, { ...head, entries: [ops[0]], next: ops[0].id, last: false }))
  assert.ok(exchangePayloadOk(PAGE_TYPE, { ...head, entries: [], last: true }))
  // malformed
  assert.equal(exchangePayloadOk(ENTRY_TYPE, { ...head, entry: ops[0], more: 1 }), false)
  assert.equal(exchangePayloadOk(ENTRY_TYPE, { ...head, entry: { ...ops[0], id: 'oid:short' } }), false)
  assert.equal(exchangePayloadOk(ENTRY_TYPE, { group: f.group, entry: ops[0] }), false)
  assert.equal(exchangePayloadOk(SYNC_TYPE, { ...head, have: ['not-an-oid'] }), false)
  assert.equal(exchangePayloadOk(SYNC_TYPE, { ...head, have: Array.from({ length: 1025 }, () => ops[0].id) }), false)
  assert.equal(exchangePayloadOk(SYNC_TYPE, { ...head, have: [], want: [] }), false)
  assert.equal(exchangePayloadOk(PAGE_TYPE, { ...head, entries: [ops[0]] }), false)
  assert.equal(exchangePayloadOk('https://real-life.org/trust-tasks/spec/x-access-other/0.1', {}), false)
})

test('the answer is the difference: everything outside the closure of have, ancestor-first, never the genesis (S1-9)', async () => {
  const { f, ops, r } = await chain(4)
  const order = ancestorFirst(r.log)
  assert.equal(order[0], f.genesis.id)
  assert.deepEqual(order.slice(1), ops.map((o) => o.id))
  // a newcomer holds the genesis only
  const all = pageOf(r.log, { have: [f.genesis.id] })
  assert.deepEqual(all.entries.map((e) => e.id), ops.map((o) => o.id))
  assert.equal(all.last, true)
  assert.equal(all.next, undefined)
  // have names a head: its ancestors are read with it
  assert.deepEqual(pageOf(r.log, { have: [ops[1].id] }).entries.map((e) => e.id), [ops[2].id, ops[3].id])
  // an id the answering replica does not know excludes nothing
  assert.equal(pageOf(r.log, { have: ['oid:' + 'A'.repeat(43)] }).entries.length, 4)
  // nothing to send: an empty last page
  assert.deepEqual(pageOf(r.log, { have: haveOf(await materialize(r.log, S)) }), { entries: [], last: true })
})

test('want: the named operations with their ancestors, themselves whatever have says (S1-9, S1-11)', async () => {
  const { ops, r } = await chain(4)
  // the requester holds up to ops[0] and asks for ops[2]: its closure outside have, not ops[3]
  assert.deepEqual(pageOf(r.log, { have: [ops[0].id], want: [ops[2].id] }).entries.map((e) => e.id), [ops[1].id, ops[2].id])
  // a wanted operation inside have is sent (its proof to merge)
  assert.deepEqual(pageOf(r.log, { have: [ops[3].id], want: [ops[1].id] }).entries.map((e) => e.id), [ops[1].id])
  // an unknown want yields nothing
  assert.deepEqual(pageOf(r.log, { have: [], want: ['oid:' + 'A'.repeat(43)] }), { entries: [], last: true })
})

test('pages: one page per request, next is the cursor of the following one, last ends; the answering replica keeps no state (S1-9)', async () => {
  const { f, ops, r } = await chain(5)
  const bound = envelopeBytes(ops[0]) * 2 + 16
  let mine = replica(f.log)
  let cursor
  const pages = []
  for (;;) {
    const page = pageOf(r.log, { have: haveOf(await materialize(mine.log, S)), ...(cursor ? { cursor } : {}) }, bound)
    pages.push(page.entries.length)
    const i = await take(mine, page.entries, 'jonas', { answers: true })
    assert.equal(i.disposition, 'effect')
    mine = i.replica
    if (page.last) break
    cursor = page.next
  }
  assert.deepEqual(pages, [2, 2, 1])
  assert.deepEqual(await materialize(mine.log, S), await materialize(r.log, S))
  // a single entry over the bound still travels alone
  assert.equal(pageOf(r.log, { have: [f.genesis.id] }, 10).entries.length, 1)
})

test('two replicas that diverged converge by one exchange each way: the state is the union of the sets (S1-1, S1-2)', async () => {
  const { f, people, r } = await chain(2)
  const [noah, lea] = people
  // Noah and Lea each admit someone, without each other's operation
  const mara = await person(0x60)
  const ben = await person(0x70)
  const atNoah = await authored(replica(r.log), await add(f, r.log, noah, ben))
  const atLea = await authored(replica(r.log), await add(f, r.log, lea, mara))
  const toNoah = pageOf(atLea.log, { have: haveOf(await materialize(atNoah.log, S)) })
  const toLea = pageOf(atNoah.log, { have: haveOf(await materialize(atLea.log, S)) })
  const n = await take(atNoah, toNoah.entries, 'lea', { answers: true })
  const l = await take(atLea, toLea.entries, 'noah', { answers: true })
  assert.deepEqual(await materialize(n.replica.log, S), await materialize(l.replica.log, S))
  assert.equal((await members(n.replica)).length, 5)
  // the next authored operation joins both heads
  const m = await materialize(n.replica.log, S)
  assert.equal(m.heads.length, 2)
  assert.deepEqual(opUnsigned(n.replica.log, m, 'member.leave', noah.anchor, {}).prev, m.heads)
})

test('intake: a known id has one effect and merges its proof; a tampered envelope is validation-failed and buffers nothing (S1-8, S1-18, S1-22)', async () => {
  const { f, ops } = await chain(1)
  const mine = replica(f.log)
  const first = await take(mine, [ops[0]], 'jonas')
  assert.deepEqual(first.verdicts.map((v) => v.kind), ['applied'])
  assert.deepEqual(first.applied, [ops[0].id])
  const again = await take(first.replica, [ops[0]], 'lea')
  assert.deepEqual(again.verdicts.map((v) => v.kind), ['duplicate'])
  assert.deepEqual(again.applied, [])
  assert.equal(again.disposition, 'effect')
  assert.equal(again.replica.log, first.replica.log)
  // the genesis sent again is known, not a second genesis
  assert.deepEqual((await take(first.replica, [f.genesis], 'lea')).verdicts.map((v) => v.kind), ['duplicate'])
  // tampered: the id no longer recomputes
  const bad = await take(mine, [{ ...ops[0], epoch: 1 }], 'jonas')
  assert.equal(bad.disposition, 'validation-failed')
  assert.equal(bad.replica.log, mine.log)
})

test('an operation of another group is invalid here, whatever its form (S1-23, 3280)', async () => {
  const a = await founding(0x10)
  const b = await founding(0x12)
  const p = await person(0x30)
  const foreign = await add(b, b.log, b.founder, p)
  const i = await take(replica(a.log), [foreign], 'jonas')
  assert.deepEqual(i.verdicts, [{ kind: 'invalid', problem: 'other-group' }])
  assert.equal(i.disposition, 'validation-failed')
})

test('a missing parent: held in the sender partition, the sender asked once for the closure, applied with its descendants when the parent comes (S1-11, S1-18)', async () => {
  const { f, ops } = await chain(3)
  const mine = replica(f.log)
  // ops[2] before its ancestors
  const early = await take(mine, [ops[2]], 'jonas')
  assert.deepEqual(early.verdicts, [{ kind: 'held', reason: 'missing-parent' }])
  assert.equal(early.disposition, 'effect')
  assert.deepEqual(early.want, [ops[1].id])
  assert.deepEqual(early.applied, [])
  assert.deepEqual([...protectedIds(early.replica, 1_000)], [ops[2].id])
  // the same entry again: no second repair (once per held instance)
  const dup = await take(early.replica, [ops[2]], 'jonas')
  assert.equal(dup.want, null)
  // the answer (want with its ancestors) heals it
  const answer = pageOf((await chain3log(f, ops)).log, { have: haveOf(await materialize(early.replica.log, S)), want: early.want })
  assert.deepEqual(answer.entries.map((e) => e.id), [ops[0].id, ops[1].id])
  const healed = await take(early.replica, answer.entries, 'jonas', { answers: true })
  assert.deepEqual(healed.applied, [ops[0].id, ops[1].id, ops[2].id])
  assert.deepEqual(healed.replica.repairs, {})
  assert.equal(Object.keys(healed.replica.log.held).length, 0)
  assert.equal((await members(healed.replica)).length, 4)
})
/** the log holding the genesis and the given operations */
async function chain3log (f, ops) {
  let r = replica(f.log)
  for (const o of ops) r = (await take(r, [o], 'self')).replica
  return r
}

test('a parent that arrives in the same intake is not asked for (a page out of order within itself)', async () => {
  const { f, ops } = await chain(3)
  const i = await take(replica(f.log), [ops[1], ops[0], ops[2]], 'jonas')
  assert.deepEqual(i.verdicts.map((v) => v.kind), ['held', 'applied', 'applied'])
  assert.equal(i.want, null)
  assert.deepEqual(i.applied, ops.map((o) => o.id))
})

test('the repair reserve: at most REPAIR_MAX protected entries per group, protected entries are never evicted, a partition full of them is rate-limited (S1-19)', async () => {
  // a page before its predecessor page: every entry lacks its parent
  const f = await founding()
  let r = replica(f.log)
  const fans = []
  // 20 members, each then admits one more: 20 operations whose parent is one of the first 20
  const firsts = []
  for (let i = 0; i < 20; i++) {
    const p = await person(0x20 + i)
    const op = await add(f, r.log, f.founder, p)
    r = await authored(r, op)
    firsts.push({ p, op })
  }
  const base = r
  for (let i = 0; i < 20; i++) {
    const q = await person(0x80 + i)
    fans.push(await add(f, base.log, firsts[i].p, q))
  }
  const mine = replica(f.log)
  const page = await take(mine, fans, 'jonas')
  assert.ok(page.verdicts.every((v) => v.kind === 'held'))
  assert.equal(protectedIds(page.replica, 1_000).size, REPAIR_MAX)
  // every fan names the one head of the base log
  assert.deepEqual(page.want, [firsts[19].op.id])
  // a partition of 2: both protected → a third entry finds no room and nothing is evicted
  const tight = { ...STAGE1_BOUNDS, perSource: 2 }
  const two = await take(mine, fans.slice(0, 2), 'jonas', { bounds: tight })
  const third = await take(two.replica, [fans[2]], 'jonas', { bounds: tight })
  assert.deepEqual(third.verdicts, [{ kind: 'rate-limited' }])
  assert.equal(third.disposition, 'rate-limited')
  assert.equal(third.replica.log, two.replica.log)
  // after the window the protection ends: largest-first eviction in the own partition, ties by id
  const later = await intake(two.replica, [fans[2]], { source: 'jonas', now: 1_000 + REPAIR_WINDOW, bounds: tight }, S)
  assert.deepEqual(later.verdicts, [{ kind: 'held', reason: 'missing-parent' }])
  assert.equal(Object.keys(later.replica.log.held).length, 2)
  assert.ok(later.replica.log.held[fans[2].id])
  // the evicted entry's repair went with it
  assert.deepEqual(Object.keys(later.replica.repairs).sort(), Object.keys(later.replica.log.held).sort())
  // another partition is never evicted for this one
  const fromLea = await take(two.replica, [fans[3]], 'lea', { bounds: tight })
  assert.deepEqual(fromLea.verdicts.map((v) => v.kind), ['held'])
  assert.equal(Object.keys(fromLea.replica.log.held).length, 3)
  // the group sum
  const sum = await take(two.replica, [fans[3]], 'lea', { bounds: { ...tight, perGroup: 2 } })
  assert.equal(sum.disposition, 'rate-limited')
})

test('an answer from the source ends its repairs: the entries stay held, unprotected (S1-19)', async () => {
  const { f, ops } = await chain(3)
  const early = await take(replica(f.log), [ops[2]], 'jonas')
  // an empty answer: a defined effect, the repair is over, no new one starts
  const empty = await take(early.replica, [], 'jonas', { answers: true })
  assert.equal(empty.disposition, 'effect')
  assert.equal(protectedIds(empty.replica, 1_000).size, 0)
  assert.ok(empty.replica.log.held[ops[2].id])
  assert.equal(empty.replica.repairs[ops[2].id].active, false)
  // an answer from someone else ends nothing
  const other = await take(early.replica, [], 'lea', { answers: true })
  assert.equal(protectedIds(other.replica, 1_000).size, 1)
})

test('a leave of a non-member: held as ineligible, no repair, never accepted, so never forwarded (S1-4, S1-10, S1-18)', async () => {
  const { f, r } = await chain(1)
  const stranger = await person(0x77)
  const m = await materialize(r.log, S)
  const l = await signEnvelope(opUnsigned(r.log, m, 'member.leave', stranger.anchor, {}), [stranger.signer], S)
  const i = await take(r, [l], 'jonas')
  assert.deepEqual(i.verdicts, [{ kind: 'held', reason: 'ineligible' }])
  assert.equal(i.want, null)
  assert.deepEqual(i.applied, [])
  assert.deepEqual(i.replica.repairs, {})
  assert.equal(pageOf(i.replica.log, { have: [f.genesis.id] }).entries.some((e) => e.id === l.id), false)
})

test('the joining buffer: entries are held unjudged until the replica is a member, then applied ancestor-first; a void join drops them (S1-6, S1-8, S1-18)', async () => {
  const { f, ops } = await chain(3)
  const mine = replica(f.log)
  // parents present, still buffered
  const b = await take(mine, [ops[1], ops[0]], 'jonas', { buffer: true })
  assert.deepEqual(b.verdicts, [{ kind: 'held', reason: 'joining' }, { kind: 'held', reason: 'joining' }])
  assert.equal(b.disposition, 'effect')
  assert.equal(b.want, null)
  assert.deepEqual(await members(b.replica), [f.founder.anchor])
  // a tampered entry is refused before any buffering
  const bad = await take(mine, [{ ...ops[0], epoch: 3 }], 'jonas', { buffer: true })
  assert.equal(bad.disposition, 'validation-failed')
  assert.equal(Object.keys(bad.replica.log.held).length, 0)
  // an accepted entry beside the buffer does not release it
  const beside = await take(b.replica, [ops[0]], 'jonas')
  assert.deepEqual(beside.verdicts.map((v) => v.kind), ['duplicate'])
  assert.equal(Object.keys(beside.replica.log.held).length, 2)
  const rel = await releaseJoining(b.replica.log, S)
  assert.deepEqual(rel.applied, [ops[0].id, ops[1].id])
  assert.equal(Object.keys(rel.log.held).length, 0)
  // a buffered entry whose parent never came stays held as a missing parent
  const lone = await take(mine, [ops[2]], 'jonas', { buffer: true })
  const rel2 = await releaseJoining(lone.replica.log, S)
  assert.deepEqual(rel2.applied, [])
  assert.equal(rel2.log.held[ops[2].id].reason, 'missing-parent')
  // void
  assert.deepEqual(dropHeld(b.replica.log).held, {})
  assert.equal(dropHeld(mine.log), mine.log)
})

test('forwarding: to every edge contact that is a member, except the source, and an admission never to its own subject (S1-10)', async () => {
  const { f, people, ops, r } = await chain(2)
  const [noah, lea] = people
  const mara = await person(0x60)
  const edges = [{ member: noah.anchor, contact: 'c-noah' }, { member: lea.anchor, contact: 'c-lea' }, { member: mara.anchor, contact: 'c-mara' }]
  // Jonas admits Mara: the admission goes to Noah and Lea, never to Mara
  const op = await add(f, r.log, f.founder, mara)
  const jonas = await take(r, [op], 'self')
  const m = await materialize(jonas.replica.log, S)
  const out = forwards(jonas.replica.log, m, jonas.applied, edges, null)
  assert.deepEqual(out.map((o) => [o.edge.contact, o.entries.map((e) => e.id)]), [['c-noah', [op.id]], ['c-lea', [op.id]]])
  // received from Lea: not back to Lea
  assert.deepEqual(forwards(jonas.replica.log, m, jonas.applied, edges, 'c-lea').map((o) => o.edge.contact), ['c-noah'])
  // Mara leaves: the leave goes to the members, Mara gets nothing more
  const l = await leave(jonas.replica.log, mara)
  const after = await take(jonas.replica, [l], 'c-mara')
  const m2 = await materialize(after.replica.log, S)
  assert.equal(isCurrentMember(m2, mara.anchor), false)
  assert.equal(isCurrentMember(m2, null), false)
  assert.deepEqual(forwards(after.replica.log, m2, after.applied, edges, 'c-mara').map((o) => o.edge.contact), ['c-noah', 'c-lea'])
  // a later operation: nothing toward the one who left (5690)
  const ben = await person(0x70)
  const op2 = await add(f, after.replica.log, noah, ben)
  const more = await take(after.replica, [op2], 'c-noah')
  assert.deepEqual(forwards(more.replica.log, await materialize(more.replica.log, S), more.applied, edges, 'c-noah').map((o) => o.edge.contact), ['c-lea'])
  // healed descendants travel with the entry that healed them, ancestor-first
  const fresh = replica(f.log)
  const held = await take(fresh, [ops[1]], 'c-noah')
  const heal = await take(held.replica, [ops[0]], 'c-noah')
  assert.deepEqual(heal.applied, [ops[0].id, ops[1].id])
  const mh = await materialize(heal.replica.log, S)
  // ops[0] admits Noah, ops[1] admits Lea: each skips its own subject
  assert.deepEqual(forwards(heal.replica.log, mh, heal.applied, edges, null).map((o) => [o.edge.contact, o.entries.map((e) => e.id)]), [['c-noah', [ops[1].id]], ['c-lea', [ops[0].id]]])
})

test('authoring: prev is the heads, and an admission over the entry bound is not authored (S1-5, S1-12)', async () => {
  const { f, r } = await chain(1)
  const p = await person(0x50)
  const fine = await add(f, r.log, f.founder, p)
  assert.equal(oversize(fine), false)
  assert.deepEqual(fine.prev, (await materialize(r.log, S)).heads)
  // the envelope's root is open (Access 3.3): an unknown field can carry any size; refused at intake as well
  const { id: _i, proof: _p, ...u } = fine
  const signed = await signEnvelope({ ...u, pad: 'x'.repeat(70_000) }, [f.founder.signer], S)
  assert.equal(oversize(signed), true)
  assert.deepEqual((await admit(r.log, signed, { source: 'jonas', now: 1 }, S)).verdict, { kind: 'invalid', problem: 'oversize' })
})
