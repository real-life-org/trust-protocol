#!/usr/bin/env node
// membership-log (access stage 1 on the holder, rltp design 2026-11): the
// group log between holders — membership/replica.ts over access/*. The
// scenario of five (S1-17): founding under linear/0.1, joins confirmed by
// the log, an admission while the founder is offline and its catch-up, a
// leave, an operation before its parent and its repair; and the negative
// and edge cases of S1-18 at the holder: who is heard, who is answered,
// the gate, the joining window, the void join.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seal, iso, jcs } from '../dist/index.js'
import { T0, ACK, ev, opts, met, communityPerson, person } from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/spec/'
const WELCOME = TT + 'x-membership-welcome/0.1'
const ENTRY = TT + 'x-access-entry/0.1'
const SYNC = TT + 'x-access-sync/0.1'
const PAGE = TT + 'x-access-page/0.1'
const short = (t) => t.slice(TT.length)

const ownerOf = async (people, o) => {
  for (const p of people) if (Object.hasOwn((await p.read()).addresses.keys, o.envelope.rkid)) return p
  return null
}

/** Delivers outbound and all it causes; `hold(o, to)` takes a document
 *  out (it is returned in `held`), `log` receives every delivery. */
async function route (people, outbound, when, { hold = () => false, rounds = 12 } = {}) {
  let out = [...outbound]
  const seen = []
  const held = []
  for (let r = 0; r < rounds; r++) {
    for (const p of people) out.push(...(await p.h.resume(when)).outbound)
    if (!out.length) break
    while (out.length) {
      const o = out.shift()
      const to = await ownerOf(people, o)
      if (!to) continue
      if (hold(o, to)) { held.push(o); continue }
      const got = await to.h.receive(o.envelope, when)
      seen.push({ o, to, got })
      if (got.disposition === 'unique' || got.disposition === 'duplicate-known') out.push(...got.outbound)
    }
  }
  return { seen, held }
}

let clock = T0 + 1_000_000
const tick = (n = 10_000) => (clock += n)

/** `inviter` (a member) invites `invitee`, who accepts; everything settles among `people`. */
async function join (people, inviter, invitee, groupId, contactId, o = {}) {
  const inv = await inviter.h.invite(groupId, contactId, opts(tick()))
  assert.equal(inv.ok, true, JSON.stringify(inv))
  await route(people, inv.outbound, tick(), o)
  const prompt = (await invitee.h.prompts()).find((p) => p.kind === 'group-invite' && p.groupId === groupId)
  const d = await invitee.h.decide(prompt.id, 'accept', opts(tick()))
  assert.equal(d.ok, true, JSON.stringify(d))
  return route(people, d.outbound, tick(), o)
}

const group = async (P, groupId) => (await P.read()).groups[groupId]
const members = async (P, groupId) => Object.keys((await group(P, groupId)).roster).sort()
const ids = async (P, groupId) => Object.keys((await group(P, groupId)).log.accepted).sort()

async function sameEverywhere (people, groupId, n) {
  const first = await members(people[0], groupId)
  assert.equal(first.length, n)
  for (const p of people) {
    assert.deepEqual(await members(p, groupId), first, 'the same members on every device')
    assert.deepEqual(await ids(p, groupId), await ids(people[0], groupId), 'the same set of operations')
    assert.equal((await group(p, groupId)).phase, 'member')
  }
}

test('S1-17: five holders — founding under linear/0.1, joins confirmed by the log, an admission while the founder is offline and its catch-up, a leave, an operation before its parent and its repair; the materialization is the same on every member\'s device', async () => {
  const [jonas, noah, lea, mara, ben, cem] = await Promise.all([0x11, 0x12, 0x13, 0x14, 0x15, 0x16].map((s) => communityPerson(s)))
  const all = [jonas, noah, lea, mara, ben, cem]
  const names = new Map([[jonas, 'jonas'], [noah, 'noah'], [lea, 'lea'], [mara, 'mara'], [ben, 'ben'], [cem, 'cem']])
  const who = (xs) => xs.map((x) => names.get(x.to) ?? 'dora')
  const jn = await met(jonas, noah, tick()), jl = await met(jonas, lea, tick()), lm = await met(lea, mara, tick()), jb = await met(jonas, ben, tick()), jc = await met(jonas, cem, tick())
  const f = await jonas.h.foundGroup({ name: 'Garten' }, opts(tick()))
  const groupId = ev(f, 'group.founded')[0].groupId
  const genesis = Object.values((await group(jonas, groupId)).log.accepted)[0]
  assert.deepEqual([genesis.op, genesis.body.adapter, genesis.proof.signatures.length], ['group.genesis', 'linear/0.1', 2])

  // Noah and Lea join: each fetches the log from Jonas and is a member once it confirms the admission
  const r1 = await join(all, jonas, noah, groupId, jn.a.id)
  assert.deepEqual(r1.seen.filter((x) => x.o.type !== ACK).map((x) => short(x.o.type)).slice(0, 4), ['membership-accept/0.2', 'x-membership-welcome/0.1', 'x-access-sync/0.1', 'x-access-page/0.1'])
  const r2 = await join(all, jonas, lea, groupId, jl.a.id)
  // Lea's admission reached Noah as an entry from Jonas, never Lea herself (S6)
  const entries = r2.seen.filter((x) => x.o.type === ENTRY)
  assert.deepEqual(who(entries), ['noah'])
  assert.deepEqual(entries[0].got.events.map((e) => e.type), ['group.admitted'])
  await sameEverywhere([jonas, noah, lea], groupId, 3)

  // Lea invites Mara while Jonas is offline: what would reach Jonas is lost
  const offline = { hold: (o, to) => to === jonas }
  const r3 = await join(all, lea, mara, groupId, lm.a.id, offline)
  assert.ok(r3.held.some((o) => o.type === ENTRY), 'Lea sent the admission toward Jonas')
  assert.equal((await members(lea, groupId)).length, 4)
  assert.equal((await members(mara, groupId)).length, 4)
  assert.equal((await members(jonas, groupId)).length, 3, 'Jonas does not know of Mara')
  assert.equal((await members(noah, groupId)).length, 3, 'nor does Noah: his only edge is Jonas')

  // Jonas comes back and asks his edges; Lea's page brings Mara, and Jonas forwards to Noah
  const back = await jonas.h.syncGroups({ when: tick() })
  assert.deepEqual(back.outbound.map((o) => o.type), [SYNC, SYNC], 'one request per invitation edge: Noah, Lea')
  const r4 = await route(all, back.outbound, tick())
  assert.ok(r4.seen.some((x) => x.o.type === PAGE && x.to === jonas && x.got.events.some((e) => e.type === 'group.admitted')))
  assert.ok(r4.seen.some((x) => x.o.type === ENTRY && x.to === noah))
  await sameEverywhere([jonas, noah, lea, mara], groupId, 4)

  // Mara leaves: the leave travels over Lea to Jonas and Noah
  const l = await mara.h.leaveGroup(groupId, opts(tick()))
  assert.equal(l.ok, true, JSON.stringify(l))
  assert.deepEqual(l.events.map((e) => e.type), ['group.left'])
  assert.deepEqual(l.outbound.map((o) => o.type), [ENTRY])
  const r5 = await route(all, l.outbound, tick())
  // (the admission held back while Jonas was offline is retried from Lea's outbox meanwhile: known, no effect)
  const departed = r5.seen.filter((x) => x.o.type === ENTRY && x.got.events.some((e) => e.type === 'group.departed'))
  assert.deepEqual(who(departed), ['lea', 'jonas', 'noah'])
  await sameEverywhere([jonas, noah, lea], groupId, 3)
  const gm = await group(mara, groupId)
  assert.deepEqual([gm.phase, gm.listed, gm.memberOp], ['left', false, undefined])
  assert.deepEqual((await mara.h.groups()).map((g) => g.phase), ['left'])

  // Ben joins through Jonas: nothing reaches Mara any more (5690)
  const r6 = await join(all, jonas, ben, groupId, jb.a.id)
  assert.deepEqual(r6.seen.filter((x) => x.to === mara && x.o.type !== ACK).map((x) => short(x.o.type)), [], 'the one who left receives nothing of the group (acks of its own documents aside)')
  await sameEverywhere([jonas, noah, lea, ben], groupId, 4)
  // Mara asks: she is answered by no one
  assert.deepEqual((await mara.h.syncGroups({ when: tick() })).outbound, [], 'a group left has no edges')

  // Noah gets an operation before its parent: Cem's admission is held back, then Jonas' next operation arrives first
  const toNoah = { hold: (o, to) => to === noah && o.type === ENTRY }
  const r7 = await join(all, jonas, cem, groupId, jc.a.id, toNoah)
  const [first] = r7.held
  const dora = await communityPerson(0x17)
  const jd = await met(jonas, dora, tick())
  const r8 = await join([...all, dora], jonas, dora, groupId, jd.a.id, toNoah)
  const [second] = r8.held
  const early = await noah.h.receive(second.envelope, tick())
  assert.equal(early.disposition, 'unique', 'held is a defined effect, acknowledged')
  assert.deepEqual(early.events, [])
  const want = early.outbound.find((o) => o.type === SYNC)
  assert.ok(want, 'the repair: a request to the sender')
  assert.equal(Object.keys((await group(noah, groupId)).log.held).length, 1)
  const r9 = await route([...all, dora], early.outbound, tick())
  const page = r9.seen.find((x) => x.o.type === PAGE && x.to === noah)
  assert.deepEqual(page.got.events.map((e) => e.type), ['group.admitted', 'group.admitted'], 'the parent arrived, the held entry healed with it')
  assert.deepEqual((await group(noah, groupId)).log.held, {})
  assert.deepEqual((await group(noah, groupId)).log.repairs, {})
  // the entry held back first arrives late: known, no second effect
  const late = await noah.h.receive(first.envelope, tick())
  assert.deepEqual([late.disposition, late.events], ['unique', []])
  await sameEverywhere([jonas, noah, lea, ben, cem, dora], groupId, 6)
})

/** A founds, B and C join through A; all met pairwise through A only. */
async function three (seeds) {
  const [A, B, C] = await Promise.all(seeds.map((s) => communityPerson(s)))
  const ab = await met(A, B, tick()), ac = await met(A, C, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  await join([A, B, C], A, B, groupId, ab.a.id)
  await join([A, B, C], A, C, groupId, ac.a.id)
  return { A, B, C, ab, ac, groupId }
}

/** a document of the exchange from `P` toward its contact, built outside the holder */
async function forgedDoc (P, contactId, type, payload, threadId = globalThis.crypto.randomUUID()) {
  const s = await P.read()
  const c = s.contacts[contactId]
  const rel = s.relationships[c.relIds[0]]
  const t = rel.tuples.find((x) => x.ownPairLabel === rel.activeHead)
  const own = await P.keys.anchorOf(t.ownPairLabel)
  const doc = { id: globalThis.crypto.randomUUID(), type, issuer: own.anchor, recipient: t.counterpartAnchor, threadId, issuedAt: iso(clock), payload }
  return seal(doc, t.counterpartKeyAgreement)
}

test('who is heard (S1-8, S1-13, S1-18): an entry or a request from a contact that is no member, for a group not held, or malformed, is refused without an ack; nothing is buffered, nothing answered', async () => {
  const { A, B, groupId } = await three([0x21, 0x22, 0x23])
  const X = await communityPerson(0x24)
  const ax = await met(A, X, tick())
  const g = await group(A, groupId)
  const entry = Object.values(g.log.accepted).find((e) => e.op === 'member.add')
  const head = { group: g.did, genesisDigest: groupId }
  const before = jcs(await group(A, groupId))
  // X is A's contact, but no member: its entry, its request
  const r1 = await A.h.receive(await forgedDoc(X, ax.b.id, ENTRY, { ...head, entry }), tick())
  assert.deepEqual([r1.disposition, r1.reason, r1.stage], ['failed', 'validation-failed', 8])
  const r2 = await A.h.receive(await forgedDoc(X, ax.b.id, SYNC, { ...head, have: [] }), tick())
  assert.deepEqual([r2.disposition, r2.reason, r2.outbound ?? []], ['failed', 'validation-failed', []])
  // a page nobody asked for, from a member
  const sB = await B.read()
  const bToA = Object.values(sB.contacts)[0].id
  const r3 = await A.h.receive(await forgedDoc(B, bToA, PAGE, { ...head, entries: [entry], last: true }), tick())
  assert.deepEqual([r3.disposition, r3.reason], ['failed', 'validation-failed'])
  // a group A does not hold; the right digest under another DID
  const other = ev(await B.h.foundGroup({ name: 'Other' }, opts(tick())), 'group.founded')[0].groupId
  const go = await group(B, other)
  const r4 = await A.h.receive(await forgedDoc(B, bToA, ENTRY, { group: go.did, genesisDigest: other, entry }), tick())
  assert.deepEqual([r4.disposition, r4.reason], ['failed', 'validation-failed'])
  const r5 = await A.h.receive(await forgedDoc(B, bToA, SYNC, { group: go.did, genesisDigest: groupId, have: [] }), tick())
  assert.deepEqual([r5.disposition, r5.reason], ['failed', 'validation-failed'])
  // malformed: stage 7
  const r6 = await A.h.receive(await forgedDoc(B, bToA, ENTRY, { ...head, entry, more: true }), tick())
  assert.deepEqual([r6.disposition, r6.reason, r6.stage], ['failed', 'malformed', 7])
  const r7 = await A.h.receive(await forgedDoc(B, bToA, SYNC, { ...head, have: ['x'] }), tick())
  assert.deepEqual([r7.disposition, r7.reason, r7.stage], ['failed', 'malformed', 7])
  // a tampered envelope from a member: its id no longer recomputes
  const r8 = await A.h.receive(await forgedDoc(B, bToA, ENTRY, { ...head, entry: { ...entry, epoch: 1 } }), tick())
  assert.deepEqual([r8.disposition, r8.reason], ['failed', 'validation-failed'])
  assert.equal(jcs(await group(A, groupId)), before, 'nothing applied, nothing buffered')
  // a member is heard: a known entry is a defined effect without a second one, a request is answered
  const r9 = await A.h.receive(await forgedDoc(B, bToA, ENTRY, { ...head, entry }), tick())
  assert.deepEqual([r9.disposition, r9.events, r9.outbound.map((o) => o.type)], ['unique', [], [ACK]])
  const r10 = await A.h.receive(await forgedDoc(B, bToA, SYNC, { ...head, have: [] }), tick())
  assert.deepEqual([r10.disposition, r10.outbound.map((o) => o.type).sort()], ['unique', [ACK, PAGE].sort()])
  assert.equal(jcs(await group(A, groupId)), before, 'an answer keeps no state')
})

test('a request from one who left is not answered (5690); one who left hears nothing; a leave as the sole member dissolves the group (4410)', async () => {
  const { A, B, C, ab, groupId } = await three([0x31, 0x32, 0x33])
  const g = await group(A, groupId)
  const head = { group: g.did, genesisDigest: groupId }
  const bToA = ab.b.id
  await route([A, B, C], (await B.h.leaveGroup(groupId, opts(tick()))).outbound, tick())
  assert.deepEqual(await members(A, groupId), await members(C, groupId))
  assert.equal((await members(A, groupId)).length, 2)
  const r1 = await A.h.receive(await forgedDoc(B, bToA, SYNC, { ...head, have: [] }), tick())
  assert.deepEqual([r1.disposition, r1.reason], ['failed', 'validation-failed'])
  // B, having left, refuses what still comes
  const aToB = ab.a.id
  const entry = Object.values(g.log.accepted).find((e) => e.op === 'member.add')
  const r2 = await B.h.receive(await forgedDoc(A, aToB, ENTRY, { ...head, entry }), tick())
  assert.deepEqual([r2.disposition, r2.reason], ['failed', 'validation-failed'])
  assert.deepEqual(await B.h.leaveGroup(groupId, opts(tick())), { ok: false, code: 'not-yet-canonical' }, 'no second leave')
  assert.deepEqual(await B.h.invite(groupId, bToA, opts(tick())), { ok: false, code: 'not-yet-canonical' })
  // the last two leave: the founder alone, then nobody
  await route([A, B, C], (await C.h.leaveGroup(groupId, opts(tick()))).outbound, tick())
  assert.deepEqual(await members(A, groupId), [(await group(A, groupId)).memberAnchor])
  const last = await A.h.leaveGroup(groupId, opts(tick()))
  assert.deepEqual([last.ok, last.outbound, last.events.map((e) => e.type)], [true, [], ['group.left']])
  const ga = await group(A, groupId)
  assert.deepEqual([ga.phase, ga.roster, ga.listed], ['left', {}, false])
  assert.deepEqual(await A.h.invite(groupId, aToB, opts(tick())), { ok: false, code: 'not-yet-canonical' }, 'a dissolved group takes no one')
  // the personal community is never left
  const P = await person(0x34)
  const pc = await P.h.foundPersonalCommunity({ name: 'Mine' }, opts(tick()))
  assert.equal(pc.ok, true, JSON.stringify(pc))
  assert.deepEqual(await P.h.leaveGroup(ev(pc, 'group.founded')[0].groupId, opts(tick())), { ok: false, code: 'personal-community' })
})

test('the gate and the joining window (S1-6, S1-18): until its log confirms the admission a holder is joining — unlisted, no invitation, no answer; the issuer\'s entries are buffered and applied on membership; a resume asks the issuer again', async () => {
  const [A, B, C] = await Promise.all([0x41, 0x42, 0x43].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick()), ac = await met(A, C, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  // B accepts; its request for the log reaches A, the page is held back
  const r1 = await join([A, B, C], A, B, groupId, ab.a.id, { hold: (o) => o.type === PAGE })
  const [page] = r1.held
  const gb = await group(B, groupId)
  assert.deepEqual([gb.phase, gb.listed, gb.memberOp, Object.keys(gb.syncs).length], ['joining', false, undefined, 1])
  assert.deepEqual((await B.h.groups()).map((g) => [g.phase, g.members.length]), [['joining', 2]], 'shown as joining, with the members the welcome named')
  assert.deepEqual(await B.h.invite(groupId, ab.b.id, opts(tick())), { ok: false, code: 'not-yet-canonical' }, 'invited before membership')
  assert.deepEqual(await B.h.leaveGroup(groupId, opts(tick())), { ok: false, code: 'not-yet-canonical' })
  // a request toward the joining holder is not answered
  const head = { group: gb.did, genesisDigest: groupId }
  const r2 = await B.h.receive(await forgedDoc(A, ab.a.id, SYNC, { ...head, have: [] }), tick())
  assert.deepEqual([r2.disposition, r2.reason], ['failed', 'validation-failed'])
  // A admits C meanwhile: the entry toward B arrives before B's page and is buffered
  const r3 = await join([A, B, C], A, C, groupId, ac.a.id, { hold: (o) => o.type === PAGE && o.envelope.rkid === page.envelope.rkid })
  const buffered = r3.seen.find((x) => x.o.type === ENTRY && x.to === B)
  assert.deepEqual([buffered.got.disposition, buffered.got.events], ['unique', []], 'buffered: a defined effect, acknowledged')
  const gb2 = await group(B, groupId)
  assert.deepEqual(Object.values(gb2.log.held).map((h) => h.reason), ['joining'])
  assert.equal(gb2.phase, 'joining')
  // a resume while joining asks the issuer again (S1-11)
  const again = await B.h.syncGroups({ when: tick() })
  assert.deepEqual(again.outbound.map((o) => [o.type, o.recipient.contactId]), [[SYNC, ab.b.id]])
  // the page held back (it does not know C) confirms the admission: B is a member, the buffer applied
  const got = await B.h.receive(page.envelope, tick())
  assert.deepEqual(got.events.map((e) => e.type), ['group.joined'])
  const gb3 = await group(B, groupId)
  assert.deepEqual([gb3.phase, gb3.listed, Object.keys(gb3.roster).length, gb3.log.held], ['member', true, 3, {}])
  assert.equal(gb3.memberOp, gb3.roster[gb3.memberAnchor].op)
  await route([A, B, C], [...again.outbound, ...got.outbound], tick())
  await sameEverywhere([A, B, C], groupId, 3)
  assert.deepEqual((await group(B, groupId)).syncs, {})
})

test('a join the log never confirms becomes void at its deadline: the buffer dropped, the group shown as void; a new admission opens it again (S1-6)', async () => {
  const [A, B] = await Promise.all([0x51, 0x52].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  await join([A, B], A, B, groupId, ab.a.id, { hold: (o) => o.type === SYNC })
  assert.equal((await group(B, groupId)).phase, 'joining')
  const until = (await group(B, groupId)).joinUntil
  await B.h.tick(until)
  assert.equal((await group(B, groupId)).phase, 'joining', 'at the deadline still joining')
  await B.h.tick(until + 1)
  const g = await group(B, groupId)
  assert.deepEqual([g.phase, g.roster, g.syncs, g.joinUntil, g.log.held], ['void', {}, {}, undefined, {}])
  assert.deepEqual((await B.h.groups()).map((x) => x.phase), ['void'])
  assert.deepEqual((await B.h.syncGroups({ when: until + 2 })).outbound, [])
})

test('two members admit the same person at once (S1-18): both admissions are canonical, the person is a member once, and every replica names the same admission', async () => {
  const [A, B, X] = await Promise.all([0x61, 0x62, 0x63].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick()), ax = await met(A, X, tick()), bx = await met(B, X, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  await join([A, B, X], A, B, groupId, ab.a.id)
  // both invite X; X accepts both; A and B are cut off from each other while they admit
  // between A and B nothing of the exchange travels; X reaches both
  const apart = { hold: (o) => (o.type === ENTRY || o.type === SYNC || o.type === PAGE) && (o.recipient.contactId === ab.a.id || o.recipient.contactId === ab.b.id) }
  await route([A, B, X], (await A.h.invite(groupId, ax.a.id, opts(tick()))).outbound, tick())
  await route([A, B, X], (await B.h.invite(groupId, bx.a.id, opts(tick()))).outbound, tick())
  const prompts = (await X.h.prompts()).filter((p) => p.kind === 'group-invite')
  assert.equal(prompts.length, 2)
  const out = []
  for (const p of prompts) out.push(...(await X.h.decide(p.id, 'accept', opts(tick()))).outbound)
  const r = await route([A, B, X], out, tick(), apart)
  assert.ok(r.held.length >= 2, 'the two admissions did not cross')
  assert.equal((await group(X, groupId)).phase, 'member')
  // the cut heals: everyone asks
  for (const P of [A, B, X]) await route([A, B, X], (await P.h.syncGroups({ when: tick() })).outbound, tick())
  await sameEverywhere([A, B, X], groupId, 3)
  const xAnchor = (await group(X, groupId)).memberAnchor
  const adds = Object.values((await group(A, groupId)).log.accepted).filter((e) => e.op === 'member.add' && e.body.subject === xAnchor)
  assert.equal(adds.length, 2, 'both admissions are in the log')
  const op = (await group(X, groupId)).memberOp
  for (const P of [A, B]) assert.equal((await group(P, groupId)).roster[xAnchor].op, op, 'one admission names the member everywhere: the smaller id')
  assert.equal(op, adds.map((e) => e.id).sort()[0])
})

test('WELCOME carries no operation id and the name travels in it, not in the genesis (S1-20)', async () => {
  const [A, B] = await Promise.all([0x71, 0x72].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'Chor' }, opts(tick())), 'group.founded')[0].groupId
  const r = await join([A, B], A, B, groupId, ab.a.id)
  assert.ok(r.seen.some((x) => x.o.type === WELCOME))
  assert.equal((await group(B, groupId)).name, 'Chor')
  assert.ok(!jcs(Object.values((await group(A, groupId)).log.accepted).find((e) => e.op === 'group.genesis')).includes('Chor'))
})

test('a join the log defeats (S1-6): the issuer that holds the leave does not answer (5690), so the join stays unconfirmed; a page that carries the admission and the leave beside it makes it void with its event; void hears nothing', async () => {
  const { access, labeledContext } = await import('../dist/index.js')
  const [A, B] = await Promise.all([0x81, 0x82].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  // B accepts; its first request for the log is lost: B stays joining
  await join([A, B], A, B, groupId, ab.a.id, { hold: (o) => o.type === SYNC })
  const gb = await group(B, groupId)
  assert.equal(gb.phase, 'joining')
  // a leave under B's member key reaches A (a second device of B, or a replay of one): A applies it
  const gA = await group(A, groupId)
  const log = { genesisDigest: groupId, accepted: gA.log.accepted, held: {} }
  const m = await access.materialize(log)
  const bKey = await labeledContext(B.seed, gb.memberLabel)
  const signer = { signer: bKey.anchor, sign: async (b) => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, bKey.ed.priv, b)) }
  const leave = await access.signEnvelope(access.opUnsigned(log, m, 'member.leave', bKey.anchor, {}), [signer])
  const r = await A.h.receive(await forgedDoc(B, ab.b.id, ENTRY, { group: gA.did, genesisDigest: groupId, entry: leave }), tick())
  assert.deepEqual(r.events.map((e) => e.type), ['group.departed'])
  // B asks again: A holds B as left and does not answer (5690); B stays joining
  const again = await B.h.syncGroups({ when: tick() })
  const seen = (await route([A, B], again.outbound, tick())).seen
  // (the first request, lost before, is retried by B's outbox: refused alike)
  const asked = seen.filter((x) => x.o.type === SYNC)
  assert.ok(asked.length >= 1 && asked.every((x) => x.got.disposition === 'failed' && x.got.reason === 'validation-failed'))
  assert.equal((await group(B, groupId)).phase, 'joining')
  // an issuer that answers anyway, on B's own request thread, with the admission and the leave beside it: void
  const thread = Object.keys((await group(B, groupId)).syncs)[0]
  const gA2 = await group(A, groupId)
  const entries = Object.values(gA2.log.accepted).filter((e) => e.op !== 'group.genesis')
  const forged = await forgedDoc(A, ab.a.id, PAGE, { group: gA2.did, genesisDigest: groupId, entries, last: true }, thread)
  const page = await B.h.receive(forged, tick())
  assert.deepEqual(page.events.map((e) => e.type), ['group.void'])
  // void hears nothing: an entry from A is refused
  const entry = Object.values(gA.log.accepted).find((e) => e.op === 'member.add')
  const r2 = await B.h.receive(await forgedDoc(A, ab.a.id, ENTRY, { group: gA.did, genesisDigest: groupId, entry }), tick())
  assert.deepEqual([r2.disposition, r2.reason], ['failed', 'validation-failed'])
})

test('the buffer decides last (S1-6): a leave under the own key buffered while joining, then the page with the admission — the join is void, never joined, and the state commits', async () => {
  const { access, labeledContext } = await import('../dist/index.js')
  const [A, B] = await Promise.all([0x91, 0x92].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  await join([A, B], A, B, groupId, ab.a.id, { hold: (o) => o.type === SYNC })
  const gb = await group(B, groupId)
  assert.equal(gb.phase, 'joining')
  const gA = await group(A, groupId)
  const log = { genesisDigest: groupId, accepted: gA.log.accepted, held: {} }
  const bKey = await labeledContext(B.seed, gb.memberLabel)
  const signer = { signer: bKey.anchor, sign: async (b) => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, bKey.ed.priv, b)) }
  const leave = await access.signEnvelope(access.opUnsigned(log, await access.materialize(log), 'member.leave', bKey.anchor, {}), [signer])
  // 1. the leave reaches B from the issuer before B holds its admission: buffered
  const early = await B.h.receive(await forgedDoc(A, ab.a.id, ENTRY, { group: gA.did, genesisDigest: groupId, entry: leave }), tick())
  assert.deepEqual([early.disposition, early.events], ['unique', []])
  assert.deepEqual(Object.values((await group(B, groupId)).log.held).map((h) => h.reason), ['joining'])
  // 2. the page on B's request thread carries the admission alone
  const thread = Object.keys((await group(B, groupId)).syncs)[0]
  const entries = Object.values(gA.log.accepted).filter((e) => e.op !== 'group.genesis')
  const page = await B.h.receive(await forgedDoc(A, ab.a.id, PAGE, { group: gA.did, genesisDigest: groupId, entries, last: true }, thread), tick())
  assert.equal(page.disposition, 'unique', JSON.stringify(page))
  assert.deepEqual(page.events.map((e) => e.type), ['group.void'])
  const gv = await group(B, groupId)
  assert.deepEqual([gv.phase, gv.listed, gv.memberOp, gv.roster, gv.log.held], ['void', false, undefined, {}, {}])
  assert.ok(gv.log.accepted[leave.id], 'the leave stands in the log')
})

test('delivery order (Zelle in jedem Zweig): the same signed operations in every order, one by one, as one page, as two pages, doubled — the same members, the same memberOp, and a standing that matches the materialization', async () => {
  const { access } = await import('../dist/index.js')
  const { standingProblem } = await import('../dist/membership/replica.js')
  const [A, X, B, C, D] = await Promise.all([0xa1, 0xa2, 0xa3, 0xa4, 0xa5].map((s) => communityPerson(s)))
  const ax = await met(A, X, tick()), ab = await met(A, B, tick()), ac = await met(A, C, tick()), ad = await met(A, D, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  // X joins and is cut off: X's state is the fixed starting point
  await join([A, X], A, X, groupId, ax.a.id)
  const start = await X.store.read()
  // A admits B, C, D and B leaves: four operations X never saw
  const cut = { hold: (o, to) => to === X && o.type !== ACK }
  await join([A, B, C, D, X], A, B, groupId, ab.a.id, cut)
  await join([A, B, C, D, X], A, C, groupId, ac.a.id, cut)
  await route([A, B, C, D, X], (await B.h.leaveGroup(groupId, opts(tick()))).outbound, tick(), cut)
  await join([A, B, C, D, X], A, D, groupId, ad.a.id, cut)
  const gA = await group(A, groupId)
  const ops = Object.values(gA.log.accepted).filter((e) => !Object.hasOwn(start.state.groups[groupId].log.accepted, e.id))
  assert.equal(ops.length, 4)
  const head = { group: gA.did, genesisDigest: groupId }
  const expectMembers = Object.keys(gA.roster).sort()
  const expectOp = (await group(A, groupId)).roster[(await group(X, groupId)).memberAnchor].op

  const reset = async () => { const { version } = await X.store.read(); assert.equal((await X.store.commit(version, structuredClone(start.state))).ok, true) }
  const check = async (label) => {
    const g = await group(X, groupId)
    assert.deepEqual(Object.keys(g.roster).sort(), expectMembers, `${label}: members`)
    assert.deepEqual(Object.keys(g.log.accepted).sort(), Object.keys(gA.log.accepted).sort(), `${label}: the accepted set`)
    assert.deepEqual(g.log.held, {}, `${label}: nothing held`)
    assert.equal(g.memberOp, expectOp, `${label}: memberOp`)
    assert.equal(standingProblem(g, await access.materialize({ genesisDigest: groupId, accepted: g.log.accepted, held: {} })), null, `${label}: the standing matches the materialization`)
  }
  const deliverEntries = async (seq) => { for (const e of seq) { const r = await X.h.receive(await forgedDoc(A, ax.a.id, ENTRY, { ...head, entry: e }), tick()); assert.equal(r.disposition, 'unique') } }
  const deliverPages = async (pages) => {
    for (const entries of pages) {
      const req = await X.h.syncGroups({ when: tick(), groupId })
      const thread = req.outbound[0].threadId
      const r = await X.h.receive(await forgedDoc(A, ax.a.id, PAGE, { ...head, entries, last: true }, thread), tick())
      assert.equal(r.disposition, 'unique', JSON.stringify(r))
    }
  }
  const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])))
  let cells = 0
  for (const seq of perms(ops)) {
    await reset(); await deliverEntries(seq); await check('entries ' + seq.map((e) => e.op).join(',')); cells++
    await reset(); await deliverPages([seq]); await check('one page'); cells++
    await reset(); await deliverPages([seq.slice(0, 2), seq.slice(2)]); await check('two pages'); cells++
  }
  // doubled: every operation twice, the second time as a page after the entries
  await reset(); await deliverEntries(ops); await deliverPages([ops]); await check('doubled'); cells++
  // out of order with a repair in between: the last operation first, then the rest as the answer
  await reset(); await deliverEntries([ops[3]]); await deliverPages([ops.slice(0, 3)]); await check('repair'); cells++
  assert.ok(cells >= 74)
})

test('#164: the content key is the key provider\'s derivation for the group DID, never in the state; a group left keeps its entry and lets log and roster go a horizon later', async () => {
  const { access, CONTENT_KEY_STAGE1_PREFIX } = await import('../dist/index.js')
  const [A, B] = await Promise.all([0xb1, 0xb2].map((s) => communityPerson(s)))
  const ab = await met(A, B, tick())
  const groupId = ev(await A.h.foundGroup({ name: 'G' }, opts(tick())), 'group.founded')[0].groupId
  const g = await group(A, groupId)
  assert.equal(g.contentKey, undefined)
  assert.ok(!JSON.stringify(g).includes('"contentKey"'), 'no such field anywhere in the group')
  // the genesis commits to exactly the provider's key for this group DID (9710)
  const key = await A.keys.contentKey(g.did)
  assert.equal(key.length, 32)
  const genesis = Object.values(g.log.accepted).find((e) => e.op === 'group.genesis')
  assert.equal(genesis.body.contentKeyCommitment, await access.contentKeyCommitment(key))
  assert.notDeepEqual(await A.keys.contentKey(g.did), await B.keys.contentKey(g.did), 'per person')
  assert.equal(typeof CONTENT_KEY_STAGE1_PREFIX, 'string')
  // leave, then the horizon
  await join([A, B], A, B, groupId, ab.a.id)
  const left = await B.h.leaveGroup(groupId, opts(tick()))
  assert.equal(left.ok, true)
  const gl = await group(B, groupId)
  assert.deepEqual([gl.phase, typeof gl.endedAt, gl.log !== undefined, Object.keys(gl.roster).length], ['left', 'number', true, 1])
  await B.h.tick(gl.endedAt + 90 * 86_400_000)
  assert.ok((await group(B, groupId)).log !== undefined, 'at the horizon still held')
  await B.h.tick(gl.endedAt + 90 * 86_400_000 + 1)
  const gone = await group(B, groupId)
  assert.deepEqual([gone.phase, gone.name, gone.log, gone.roster, gone.endedAt], ['left', 'G', undefined, {}, gl.endedAt])
  assert.deepEqual((await B.h.groups()).map((x) => [x.name, x.phase, x.members.length]), [['G', 'left', 0]])
})
