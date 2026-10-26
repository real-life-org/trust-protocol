#!/usr/bin/env node
// membership-holder (lib Stage 2, PR 7a): groups on the holder
// (membership/holder.ts) — found, the prelude and the invite, the accept on
// a group-invite prompt, admission and welcome, the group star between
// members through the in-library Access, vouches as evidence, decline,
// forged documents, signed acks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labeledContext, pairContext, diSign, seal, unseal, iso, digestDoc, oidOf, ecdh, xRawOfMk } from '../dist/index.js'
import { buildGroupStarWith } from '../dist/group-star.js'
import { T0, ACK, ev, opts, settle, met, communityPerson, person } from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/spec/'
const INVITE = TT + 'membership-invite/0.2'
const ACCEPT = TT + 'membership-accept/0.2'
const EVIDENCE = TT + 'membership-evidence/0.2'
const WELCOME = TT + 'x-membership-welcome/0.1'

/** A founds, invites B (its contact), B accepts: the whole flow, settled. */
async function joined (A, B, { threshold, t = T0 } = {}) {
  const { a, b } = await met(A, B, t)
  const f = await A.h.foundGroup({ name: 'Garden', ...(threshold ? { vouchThreshold: threshold } : {}) }, opts(t + 10_000))
  assert.equal(f.ok, true, JSON.stringify(f))
  const groupId = ev(f, 'group.founded')[0].groupId
  const inv = await A.h.invite(groupId, a.id, opts(t + 11_000))
  assert.equal(inv.ok, true, JSON.stringify(inv))
  const seen = await settle([A, B], inv.outbound, t + 12_000)
  return { a, b, groupId, seen }
}

test('membership: found → invite (prelude, invite) → group-invite prompt → accept → admission → welcome; both hold the group with both members', async () => {
  const A = await communityPerson(0x61), B = await communityPerson(0x62)
  const { b, groupId, seen } = await joined(A, B)
  const sA = await A.read()
  const g = sA.groups[groupId]
  assert.equal(g.memberOp, oidOf(groupId), 'the founder\'s memberOp is the genesis\'s oid (5400)')
  assert.equal(g.memberAnchor, (await A.keys.anchorOf(g.memberLabel)).anchor)
  // B: the prelude answered on its own, the invite surfaced as a prompt
  const [prompt] = await B.h.prompts()
  assert.deepEqual([prompt.kind, prompt.groupId, prompt.contactId], ['group-invite', groupId, b.id])
  assert.ok(seen.some((x) => x.o.type === INVITE && x.got.disposition === 'unique'))
  const sB = await B.read()
  const [inv] = Object.values(sB.joining.invites)
  assert.equal(inv.status, 'open')
  assert.ok(sB.register.labels.includes(inv.memberLabel), 'the member label in the register before its anchor is shown')
  // B accepts: the accept goes, the welcome comes back
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 20_000))
  assert.equal(d.ok, true, JSON.stringify(d))
  assert.deepEqual(d.outbound.map((o) => o.type), [ACCEPT])
  const r = await settle([A, B], d.outbound, T0 + 21_000)
  assert.ok(r.some((x) => x.got.events?.some((e) => e.type === 'group.admitted')))
  assert.ok(r.some((x) => x.o.type === WELCOME && x.got.events?.some((e) => e.type === 'group.joined')))
  const [ga] = await A.h.groups(), [gb] = await B.h.groups()
  assert.deepEqual([ga.id, gb.id, ga.name, gb.name], [groupId, groupId, 'Garden', 'Garden'])
  assert.deepEqual(ga.members.map((m) => m.anchor).sort(), gb.members.map((m) => m.anchor).sort())
  assert.equal(ga.members.length, 2)
  assert.deepEqual(ga.members.filter((m) => m.self).length, 1)
  const sB2 = await B.read()
  assert.equal(sB2.groups[groupId].memberOp, oidOf(Object.values(sB2.joining.invites)[0].acceptDigest), 'the admission named by the accept digest')
  assert.equal(Object.values(sB2.joining.invites)[0].status, 'joined')
  // the invite, the accept and the welcome were acknowledged: delivered at their senders
  for (const [P, type] of [[A, INVITE], [B, ACCEPT], [A, WELCOME]]) {
    const s = await P.read()
    const [digest] = Object.entries(s.outbox).find(([, o]) => o.type === type)
    assert.equal((await P.h.deliveryStatus(digest)).items[0].status, 'delivered', type)
  }
})

test('membership: the founder stands in the roster under its fresh founding pair anchor, never group/<digest> (RLTP-ACC-3235, 3275)', async () => {
  const A = await communityPerson(0x6c)
  const f = await A.h.foundGroup({ name: 'Werk' }, opts(T0))
  const groupId = ev(f, 'group.founded')[0].groupId
  const g = (await A.read()).groups[groupId]
  assert.ok(g.memberLabel.startsWith('pair/'), 'the founder acts under the founding pair label')
  assert.equal(g.genesis.founder, g.memberAnchor, 'the genesis names the founding anchor')
  const derived = await labeledContext(A.seed, 'group/' + groupId)
  assert.deepEqual(Object.keys(g.roster), [g.memberAnchor], 'one roster entry: the founding anchor')
  assert.ok(!Object.hasOwn(g.roster, derived.anchor), 'the derived group/<digest> anchor is not in the roster')
  assert.equal(g.roster[g.memberAnchor].op, oidOf(groupId), 'admitted by the genesis (5400)')
  assert.ok((await A.read()).register.labels.includes(g.memberLabel), 'the founding label is in the register')
})

test('membership: a welcome without an accepted invitation creates no group; a second welcome for a held group rewrites nothing (ported from the probe, CodeRabbit #5)', async () => {
  const A = await communityPerson(0x6d), B = await communityPerson(0x6e)
  const { groupId, seen } = await joined(A, B)
  const invEnv = seen.find((x) => x.o.type === INVITE).o
  // B declines; a welcome re-signed by the inviter in the invitation's thread finds no accepted invitation
  const [pb] = await B.h.prompts()
  await B.h.decide(pb.id, 'decline', opts(T0 + 13_000))
  const memberB = await labeledContext(B.seed, 'group/' + groupId)
  const invite = (await unseal(invEnv.envelope, memberB.x.priv)).document
  const actx = await labeledContext(A.seed, (await A.read()).groups[groupId].memberLabel)
  const forged = await diSign(actx, {
    id: '3b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', type: WELCOME, issuer: actx.anchor, recipient: memberB.anchor, threadId: invite.threadId, issuedAt: iso(T0 + 14_000),
    payload: { genesisDigest: groupId, group: invite.payload.invite.credentialSubject.group, name: 'Garden', genesis: (await A.read()).groups[groupId].genesis, vouchThreshold: '1', accept: groupId,
      roster: [{ anchor: actx.anchor, op: oidOf(groupId), keyAgreement: actx.keyAgreement }, { anchor: memberB.anchor, op: oidOf(groupId), keyAgreement: memberB.keyAgreement }] },
  }, iso(T0 + 14_000))
  const r = await B.h.receive(await seal(forged, memberB.keyAgreement), T0 + 14_000)
  assert.deepEqual([r.disposition, r.reason], ['failed', 'validation-failed'])
  assert.deepEqual(await B.h.groups(), [], 'no group without an accepted invitation')
  // C joins; its welcome, delivered again in another document with another name, changes nothing
  const C = await communityPerson(0x6f)
  const { a: ac } = await met(A, C, T0 + 100_000)
  await settle([A, C], (await A.h.invite(groupId, ac.id, opts(T0 + 110_000))).outbound, T0 + 111_000)
  const [pc] = await C.h.prompts()
  const got = await settle([A, C], (await C.h.decide(pc.id, 'accept', opts(T0 + 112_000))).outbound, T0 + 113_000)
  const welcome = got.find((x) => x.o.type === WELCOME)
  assert.deepEqual(welcome.got.events.map((e) => e.type), ['group.joined'])
  const memberC = await labeledContext(C.seed, 'group/' + groupId)
  const wDoc = (await unseal(welcome.o.envelope, memberC.x.priv)).document
  const { proof: _p, ...wBody } = wDoc
  const second = await diSign(actx, { ...wBody, id: '4b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', payload: { ...wBody.payload, name: 'Other' } }, wDoc.issuedAt)
  const before = await C.h.groups()
  const r2 = await C.h.receive(await seal(second, memberC.keyAgreement), T0 + 114_000)
  assert.equal(r2.disposition, 'unique', 'taken as a document, absorbed by the held group')
  assert.deepEqual(r2.events.filter((e) => e.type === 'group.joined'), [])
  assert.deepEqual((await C.h.groups()).map(({ commitSeq: _, ...g }) => g), before.map(({ commitSeq: _, ...g }) => g), 'the held group is not rewritten')
})

test('membership: a late joiner sees the groups it shares with a contact from the group star it accepted before joining (the blinded union is re-matched on join, 5520)', async () => {
  const A = await communityPerson(0x5d), B = await communityPerson(0x5e)
  const { a, b } = await met(A, B)
  const f = await A.h.foundGroup({ name: 'Garden' }, opts(T0 + 10_000))
  const groupId = ev(f, 'group.founded')[0].groupId
  // A's group star toward B lists the group (blinded); B is in no group yet
  const s1 = await settle([A, B], [], T0 + 11_000)
  assert.ok(s1.some((x) => x.o.type === TT + 'group-star/0.1' && x.got.disposition === 'unique'), 'A\'s group star reached B')
  assert.equal((await B.h.contact(b.id)).sharedGroups?.length ?? 0, 0, 'no shared group before B joins')
  // B joins; A's group star toward B does not change (no divergence), so nothing new arrives
  await settle([A, B], (await A.h.invite(groupId, a.id, opts(T0 + 12_000))).outbound, T0 + 13_000)
  const [p] = await B.h.prompts()
  const r = await settle([A, B], (await B.h.decide(p.id, 'accept', opts(T0 + 14_000))).outbound, T0 + 15_000)
  assert.ok(r.some((x) => x.got.events?.some((e) => e.type === 'group.joined')))
  assert.ok(!r.some((x) => x.o.type === TT + 'group-star/0.1' && x.o.recipient.contactId === a.id), 'no new group star from A toward B')
  assert.deepEqual((await B.h.contact(b.id)).sharedGroups, [groupId], 'B now sees the group it shares with A, from the star it already held')
})

test('membership: the group star between members opens through the in-library Access — the sealed pair resolves the founder\'s memberOp on the roster', async () => {
  const A = await communityPerson(0x63), B = await communityPerson(0x64)
  const { a, b, groupId } = await joined(A, B)
  const [prompt] = await B.h.prompts()
  await settle([A, B], (await B.h.decide(prompt.id, 'accept', opts(T0 + 20_000))).outbound, T0 + 21_000)
  // trust both ways and the sealed group star on (2760: it has no default recipient)
  const out = []
  for (const [P, c] of [[A, a], [B, b]]) {
    out.push(...(await P.h.trust(c.id, opts(T0 + 30_000))).outbound)
    out.push(...(await P.h.setClass(c.id, 'sealedGroupStar', 'on', opts(T0 + 30_001))).outbound)
  }
  const r = await settle([A, B], out, T0 + 31_000)
  assert.ok(r.some((x) => x.got.events?.some((e) => e.type === 'groupStar.accepted')))
  const [b2] = await B.h.contacts()
  assert.deepEqual(b2.sharedGroups, [groupId], 'the group shared with the contact (5520)')
  const sB = await B.read()
  const held = Object.values(sB.relationships).map((rel) => rel.memory.groupMembers).find(Boolean)
  const sA = await A.read()
  assert.deepEqual(held?.[groupId], { member: sA.groups[groupId].memberAnchor, memberOp: oidOf(groupId) }, 'the sealed pair accepted: resolve(oid) on the roster')
})

test('membership: decline closes the prompt and sends nothing; tick retains the declined invitation away', async () => {
  const A = await communityPerson(0x65), B = await communityPerson(0x66)
  await joined(A, B)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'decline', opts(T0 + 20_000))
  assert.deepEqual([d.ok, d.outbound], [true, []])
  assert.equal(Object.values((await B.read()).joining.invites)[0].status, 'declined')
  await B.h.tick(T0 + 20_001)
  assert.deepEqual((await B.read()).joining.invites, {})
  assert.deepEqual(await B.h.groups(), [])
})

test('membership: an invite naming another anchor than the own derivation is refused (the prelude check, 3030); a forged accept is refused (3270)', async () => {
  const A = await communityPerson(0x67), B = await communityPerson(0x68)
  const { groupId } = await joined(A, B)
  const sA = await A.read(), sB = await B.read()
  const g = sA.groups[groupId]
  const actx = await labeledContext(A.seed, g.memberLabel)
  const [pre] = Object.values(sB.joining.preludes)
  const mine = await B.keys.anchorOf(pre.memberLabel)
  const at = iso(T0 + 13_000)
  // a credential for another group's digest, sealed to B's member key of this group
  const other = await digestDoc({ other: 1 })
  const card = (Object.values(sB.joining.invites)[0].invite).payload.invite.credentialSubject.card
  const cred = await diSign(actx, {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://firstperson.network/credentials/dtg/v1', 'https://real-life.org/rltp/v1'],
    type: ['VerifiableCredential', 'DTGCredential', 'InvitationCredential', 'MembershipInvite'], issuer: actx.anchor,
    credentialSubject: { id: mine.anchor, group: g.did, genesisDigest: other, card }, validFrom: at, validUntil: iso(T0 + 86_400_000), taskContext: '0b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d',
  }, at)
  const doc = { id: '1b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', type: INVITE, issuer: actx.anchor, recipient: mine.anchor, threadId: '0b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', issuedAt: at, payload: { invite: cred } }
  const r = await B.h.receive(await seal(doc, mine.keyAgreement), T0 + 13_000)
  assert.deepEqual([r.disposition, r.reason, r.ref], ['failed', 'validation-failed', 'RLTP-MT-3030'])
  // B accepts; the accept with its subject changed no longer verifies
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 20_000))
  const ownA = (await labeledContext(A.seed, g.memberLabel))
  const opened = (await unseal(d.outbound[0].envelope, ownA.x.priv)).document
  const forged = { ...opened, id: '2b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', payload: { accept: { ...opened.payload.accept, candidacy: true } } }
  const f = await A.h.receive(await seal(forged, ownA.keyAgreement), T0 + 20_500)
  assert.deepEqual([f.disposition, f.reason, f.ref], ['failed', 'validation-failed', 'RLTP-MT-2130'])
  assert.equal(Object.keys((await A.read()).groups[groupId].roster).length, 1, 'nothing admitted')
  assert.equal((await A.h.receive(d.outbound[0].envelope, T0 + 21_000)).disposition, 'unique')
  assert.equal(Object.keys((await A.read()).groups[groupId].roster).length, 2)
})

/** Read, change and write back a holder's stored state (a test's stand-in
 *  for what this library does not build, here Access's policy.change). */
async function edit (P, fn) {
  const { state, version } = await P.store.read()
  const s = structuredClone(state)
  fn(s)
  assert.equal((await P.store.commit(version, s)).ok, true)
}

test('membership: a vouch rule of two — the inviter relays the consent pair to the other member, whose vouch@2 travels back as evidence and completes the admission (Access 4.2, Membership 3.4)', async () => {
  const A = await communityPerson(0x69), B = await communityPerson(0x6a), C = await communityPerson(0x6b)
  // C joins first under the rule of one
  const { groupId } = await joined(A, C)
  const [pc] = await C.h.prompts()
  await settle([A, C], (await C.h.decide(pc.id, 'accept', opts(T0 + 20_000))).outbound, T0 + 21_000)
  assert.equal((await A.h.groups())[0].members.length, 2)
  // the group's rule becomes two (a policy.change this library does not build)
  await edit(A, (s) => { s.groups[groupId].rules.vouchThreshold = '2' })
  // A meets B and invites; B accepts: one member stands behind it, not two
  const t = T0 + 100_000
  const { a: ab } = await met(A, B, t)
  const inv = await A.h.invite(groupId, ab.id, opts(t + 10_000))
  await settle([A, B], inv.outbound, t + 11_000)
  const [pb] = await B.h.prompts()
  const acc = await B.h.decide(pb.id, 'accept', opts(t + 12_000))
  const r = await settle([A, B, C], acc.outbound, t + 13_000)
  assert.ok(r.some((x) => x.o.type === EVIDENCE && x.got.disposition === 'unique'), 'the pair relayed to C')
  const [ga] = await A.h.groups()
  assert.equal(ga.members.length, 2, 'not admitted yet')
  assert.deepEqual(ga.pending.map((p) => p.vouches), [0])
  const [gc] = await C.h.groups()
  assert.equal(gc.pending.length, 1, 'C holds the pair and can vouch')
  // C vouches: the evidence with its vouch goes to A, which admits
  const member = gc.pending[0].member
  const v = await C.h.vouchFor(groupId, member, opts(t + 14_000))
  assert.equal(v.ok, true, JSON.stringify(v))
  assert.deepEqual(v.events.map((e) => e.type), ['group.vouched'])
  assert.deepEqual(await C.h.vouchFor(groupId, member, opts(t + 14_001)), { ok: false, code: 'already-given' })
  const r2 = await settle([A, B, C], v.outbound, t + 15_000)
  assert.ok(r2.some((x) => x.got.events?.some((e) => e.type === 'group.admitted')))
  assert.ok(r2.some((x) => x.got.events?.some((e) => e.type === 'group.joined')))
  assert.equal((await A.h.groups())[0].members.length, 3)
  assert.equal((await B.h.groups())[0].members.length, 3, 'the welcome carries the roster')
  assert.deepEqual((await A.h.groups())[0].pending, [])
  assert.deepEqual(await A.h.vouchFor(groupId, member, opts(t + 16_000)), { ok: false, code: 'no-evidence' })
})

// ── review round 1 ─────────────────────────────────────────────────────

test('membership: a prelude reply is taken only for the group the prelude asked for — a member card for another group on its thread is refused, no invite issued (review item 1)', async () => {
  const A = await communityPerson(0x70), B = await communityPerson(0x71)
  const { a } = await met(A, B)
  const g1 = ev(await A.h.foundGroup({ name: 'One' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
  const g2 = ev(await A.h.foundGroup({ name: 'Two' }, opts(T0 + 10_001)), 'group.founded')[0].groupId
  const inv = await A.h.invite(g1, a.id, opts(T0 + 11_000))
  // B answers on the prelude's thread, but with a member card for G2
  const sA = await A.read()
  const [thread] = Object.keys(sA.groups[g1].preludes)
  const out = inv.outbound[0]
  const sB = await B.read()
  const bTuple = Object.values(sB.relationships).flatMap((r) => r.tuples).find((t) => t.counterpartKeyAgreement === out.recipient.rkid)
  const bctx = await labeledContext(B.seed, bTuple.ownPairLabel)
  const mctx = await labeledContext(B.seed, 'group/' + g2)
  const at = iso(T0 + 11_500)
  const card = await diSign(mctx, { version: 'rltp-card/0.25', anchor: mctx.anchor, keyAgreement: mctx.keyAgreement }, at)
  const reply = await diSign(bctx, { id: crypto.randomUUID(), type: TT + 'membership-prelude-reply/0.1', issuer: bctx.anchor, recipient: bTuple.counterpartAnchor, threadId: thread, issuedAt: at, payload: { genesisDigest: g2, card } }, at)
  const got = await A.h.receive(await seal(reply, bTuple.counterpartKeyAgreement), T0 + 11_500)
  assert.deepEqual([got.disposition, got.reason, got.ref], ['failed', 'validation-failed', 'RLTP-MT-3965'])
  assert.deepEqual(Object.keys((await A.read()).groups[g2].invitations), [])
  // the genuine answer for G1 still works
  const r = await settle([A, B], inv.outbound, T0 + 12_000)
  assert.ok(r.some((x) => x.o.type === INVITE && x.got.disposition === 'unique'))
  assert.equal(Object.keys((await A.read()).groups[g1].invitations).length, 1)
  assert.deepEqual((await A.read()).groups[g1].preludes, {}, 'the prelude is answered')
})

test('membership: a new invitation opens its own thread beside an earlier one — a declined invite does not block a new one (review items 4, round 2 B2)', async () => {
  const A = await communityPerson(0x72), B = await communityPerson(0x73)
  const { a, groupId } = await joined(A, B)
  const [prompt] = await B.h.prompts()
  await B.h.decide(prompt.id, 'decline', opts(T0 + 20_000))
  const again = await A.h.invite(groupId, a.id, opts(T0 + 30_000))
  assert.equal(again.ok, true, JSON.stringify(again))
  const r = await settle([A, B], again.outbound, T0 + 31_000)
  assert.ok(r.some((x) => x.o.type === INVITE && x.got.disposition === 'unique'), 'a new invite delivered')
  assert.equal((await B.h.prompts()).filter((x) => x.kind === 'group-invite').length, 1)
  assert.equal(Object.keys((await A.read()).groups[groupId].invitations).length, 2, 'both threads held')
})

test('membership: an accept signed in time on an earlier thread still admits after a new invitation opened (round 2 B2)', async () => {
  const A = await communityPerson(0x7c), B = await communityPerson(0x7d)
  const { a, groupId } = await joined(A, B)
  const [first] = await B.h.prompts()
  const acc = await B.h.decide(first.id, 'accept', opts(T0 + 20_000))       // signed in time, held back
  const again = await A.h.invite(groupId, a.id, opts(T0 + 30_000))
  await settle([A, B], again.outbound, T0 + 31_000)
  const r = await settle([A, B], acc.outbound, T0 + 5 * 86_400_000)        // delivered late
  assert.ok(r.some((x) => x.got.events?.some((e) => e.type === 'group.admitted')))
  assert.ok(r.some((x) => x.got.events?.some((e) => e.type === 'group.joined')))
  assert.deepEqual((await A.read()).groups[groupId].invitations, {}, 'the admission answers every invitation to its subject')
})

test('membership: the accept → admission → welcome chain survives two horizons — accept at the deadline, delivered after 80 days, welcome 20 days later (round 2 B3)', async () => {
  const A = await communityPerson(0x7e), B = await communityPerson(0x7f)
  await joined(A, B)
  const [p] = await B.h.prompts()
  const deadline = T0 + 11_000 + 24 * 3_600_000                               // validUntil of the invite
  const acc = await B.h.decide(p.id, 'accept', opts(deadline))
  assert.equal(acc.ok, true, JSON.stringify(acc))
  const t1 = deadline + 80 * 86_400_000
  await A.h.tick(t1); await B.h.tick(t1)
  const got = await A.h.receive(acc.outbound[0].envelope, t1 + 1)
  assert.deepEqual(got.events.map((e) => e.type), ['group.admitted'])
  const welcome = got.outbound.find((o) => o.type === WELCOME)
  const t2 = t1 + 20 * 86_400_000
  await B.h.tick(t2)
  const w = await B.h.receive(welcome.envelope, t2 + 1)
  assert.equal(w.disposition, 'unique', JSON.stringify(w))
  assert.deepEqual(w.events.map((e) => e.type), ['group.joined'])
})

test('membership: founding takes the rule of one only; the inviter\'s own vouch is refused as own-admission (review item 6)', async () => {
  const A = await communityPerson(0x74), B = await communityPerson(0x75)
  assert.deepEqual(await A.h.foundGroup({ name: 'Strict', vouchThreshold: '2' }, opts(T0)), { ok: false, code: 'threshold-unsupported' })
  const { groupId } = await joined(A, B)
  await edit(A, (s) => { s.groups[groupId].rules.vouchThreshold = '2' })
  const [p] = await B.h.prompts()
  await settle([A, B], (await B.h.decide(p.id, 'accept', opts(T0 + 20_000))).outbound, T0 + 21_000)
  const [g] = await A.h.groups()
  assert.equal(g.pending.length, 1)
  assert.deepEqual(await A.h.vouchFor(groupId, g.pending[0].member, opts(T0 + 22_000)), { ok: false, code: 'own-admission' })
})

test('membership: bounded state — evidence leaves past its invite\'s life and a horizon; an answered prelude\'s binding stays while its relationship is current (3945) and leaves after the departure, its member key without a tombstone, and a later prelude to the same group uses the same key again (review item 9, round 2 B4)', async () => {
  const A = await communityPerson(0x76), B = await communityPerson(0x77)
  const { groupId } = await joined(A, B)
  await edit(A, (s) => { s.groups[groupId].rules.vouchThreshold = '2' })
  const [p] = await B.h.prompts()
  await settle([A, B], (await B.h.decide(p.id, 'accept', opts(T0 + 20_000))).outbound, T0 + 21_000)
  assert.equal((await A.h.groups())[0].pending.length, 1)
  await A.h.tick(T0 + 2 * 86_400_000)
  assert.equal((await A.h.groups())[0].pending.length, 1, 'an accept signed in time may still be on its way')
  await A.h.tick(T0 + 93 * 86_400_000)
  assert.deepEqual((await A.h.groups())[0].pending, [], 'evidence past validUntil + skew + the horizon')
  // B answered a prelude of a second group whose invite never comes
  const C = await communityPerson(0x78)
  const { a: ca } = await met(C, B, T0 + 40_000)
  const g2 = ev(await C.h.foundGroup({ name: 'Quiet' }, opts(T0 + 50_000)), 'group.founded')[0].groupId
  const inv = await C.h.invite(g2, ca.id, opts(T0 + 51_000))
  assert.equal((await B.h.receive(inv.outbound[0].envelope, T0 + 52_000)).disposition, 'unique')   // its answer is never delivered
  const label = 'group/' + g2
  const rkidOf = async () => Object.entries((await B.read()).addresses.keys).find(([, k]) => k.label === label)?.[0]
  const rkid = await rkidOf()
  assert.ok(rkid)
  const far = T0 + 95 * 86_400_000
  await B.h.tick(far); await B.h.tick(far + 1)
  assert.ok(Object.values((await B.read()).joining.preludes).some((x) => x.group === g2), 'the binding stays while its relationship is current (3945)')
  assert.equal(await rkidOf(), rkid, 'and the member key with it')
  // B departs from C: the binding leaves at the next tick, the member key without a tombstone
  const cb = Object.values((await B.read()).joining.preludes).find((x) => x.group === g2).contactId
  assert.equal((await B.h.depart(cb, opts(far + 2))).ok, true)
  await B.h.tick(far + 3); await B.h.tick(far + 4)
  const sB = await B.read()
  assert.ok(!Object.values(sB.joining.preludes).some((x) => x.group === g2), 'the binding left with its relationship (3945)')
  assert.equal(await rkidOf(), undefined, 'its member key left the addresses')
  assert.ok(!sB.addresses.tombstones.includes(rkid), 'without a tombstone: an identity context, not a retired address')
  // C and B meet again; C invites B to the same group: the same key, the invite delivered
  await C.h.tick(far)
  const { a: ca2 } = await met(C, B, far + 1000)
  const again = await C.h.invite(g2, ca2.id, opts(far + 100_000))
  const r = await settle([B, C], again.outbound, far + 101_000)
  assert.ok(r.some((x) => x.o.type === INVITE && x.got.disposition === 'unique'), 'the invite reaches the same member key')
  assert.equal(await rkidOf(), rkid)
})

test('membership: the prelude proves its claimed inviter on its own channel — a contact claiming another member\'s anchor is refused, A\'s genuine binding replayed on another channel is refused before and after the attribution, A\'s prelude still binds (round 2 B5, round 3)', async () => {
  const A = await communityPerson(0x6c), B = await communityPerson(0x6d), C = await communityPerson(0x6e)
  const { a: ab } = await met(A, B)
  await met(C, B, T0 + 5000)
  const gid = ev(await A.h.foundGroup({ name: 'Real' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
  const inv = await A.h.invite(gid, ab.id, opts(T0 + 11_000))
  const pre = inv.outbound[0]
  // A's request, opened with B's key before B has received it
  const bLabelA = (await B.read()).addresses.keys[pre.envelope.rkid].label
  const real = (await unseal(pre.envelope, (await labeledContext(B.seed, bLabelA)).x.priv)).document
  // C's pair channel toward B
  const bKeys = (await B.read()).addresses.keys
  const cTuple = Object.values((await C.read()).relationships).flatMap((r) => r.tuples).find((t) => Object.hasOwn(bKeys, t.counterpartKeyAgreement))
  const cctx = await labeledContext(C.seed, cTuple.ownPairLabel)
  const forge = async (payload, threadId, when) => {
    const at = iso(when)
    return seal(await diSign(cctx, { id: crypto.randomUUID(), type: TT + 'membership-prelude-request/0.1', issuer: cctx.anchor, recipient: cTuple.counterpartAnchor, threadId, issuedAt: at, payload }, at), cTuple.counterpartKeyAgreement)
  }
  // a claimed inviter without its proof: C signs the binding with its own key
  const b = real.payload.binding
  const own = await diSign(cctx, { type: b.type, inviter: b.inviter, genesisDigest: b.genesisDigest, threadId: '9b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', from: cctx.anchor, to: cTuple.counterpartAnchor }, iso(T0 + 12_000))
  const r1 = await B.h.receive(await forge({ ...real.payload, binding: own }, '9b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', T0 + 12_000), T0 + 12_000)
  assert.deepEqual([r1.disposition, r1.reason, r1.ref], ['failed', 'validation-failed', 'RLTP-MT-3905'])
  // A's genuine binding replayed by C on C's own channel, BEFORE A's prelude arrived: its pair anchors are A's channel's
  const r2 = await B.h.receive(await forge(real.payload, real.threadId, T0 + 12_100), T0 + 12_100)
  assert.deepEqual([r2.disposition, r2.reason, r2.ref], ['failed', 'validation-failed', 'RLTP-MT-3905'])
  assert.deepEqual((await B.read()).joining.preludes, {}, 'nothing bound to C')
  // A's prelude binds to A's contact, and the invite surfaces as A's
  const answered = await B.h.receive(pre.envelope, T0 + 12_500)
  assert.equal(answered.disposition, 'unique')
  const sB = await B.read()
  const viaA = Object.values(sB.relationships).find((r) => r.tuples.some((t) => t.rkid === pre.envelope.rkid)).contactId
  assert.equal(Object.values(sB.joining.preludes).find((x) => x.group === gid).contactId, viaA)
  await settle([A, B], answered.outbound, T0 + 13_000)
  const [p] = (await B.h.prompts()).filter((x) => x.kind === 'group-invite')
  assert.equal(p.contactId, viaA)
  // years later: the binding lives with its relationship (3945), and the replay is still refused from its own bytes
  const far = T0 + 2 * 365 * 86_400_000
  await B.h.tick(far)
  assert.ok(Object.values((await B.read()).joining.preludes).some((x) => x.group === gid), 'the binding is kept while its relationship is current')
  const r3 = await B.h.receive(await forge(real.payload, real.threadId, far), far)
  assert.deepEqual([r3.disposition, r3.reason, r3.ref], ['failed', 'validation-failed', 'RLTP-MT-3905'])
})

test('membership: two members invite the same person — each invite surfaces as the contact that asked (preludes per group and inviter, review item 10)', async () => {
  const A = await communityPerson(0x79), B = await communityPerson(0x7a), C = await communityPerson(0x7b)
  const { groupId } = await joined(A, C)
  const [pc] = await C.h.prompts()
  await settle([A, C], (await C.h.decide(pc.id, 'accept', opts(T0 + 20_000))).outbound, T0 + 21_000)
  const t = T0 + 100_000
  const ab = await met(A, B, t)
  const cb = await met(C, B, t + 50_000)
  const i1 = await A.h.invite(groupId, ab.a.id, opts(t + 60_000))
  const i2 = await C.h.invite(groupId, cb.a.id, opts(t + 60_001))
  await settle([A, B, C], [...i1.outbound, ...i2.outbound], t + 61_000)
  const prompts = (await B.h.prompts()).filter((x) => x.kind === 'group-invite')
  assert.deepEqual(prompts.map((x) => x.contactId).sort(), [ab.b.id, cb.b.id].sort(), 'one prompt per inviter, each attributed to its contact')
  const sB = await B.read()
  for (const inv of Object.values(sB.joining.invites)) {
    const issuer = inv.invite.payload.invite.issuer
    const expect = issuer === (await A.read()).groups[groupId].memberAnchor ? ab.b.id : cb.b.id
    assert.equal(inv.contactId, expect)
  }
})

// ── forgery negatives (ported from the simulator's trust and groups suites) ──

/** A founds under a rule of two with C joined; B consents; C holds the pair. */
async function ruleOfTwo (fills) {
  const [A, B, C] = await Promise.all(fills.map((f) => communityPerson(f)))
  const { groupId } = await joined(A, C)
  const [pc] = await C.h.prompts()
  await settle([A, C], (await C.h.decide(pc.id, 'accept', opts(T0 + 20_000))).outbound, T0 + 21_000)
  await edit(A, (s) => { s.groups[groupId].rules.vouchThreshold = '2' })
  const t = T0 + 100_000
  const { a: ab } = await met(A, B, t)
  await settle([A, B], (await A.h.invite(groupId, ab.id, opts(t + 10_000))).outbound, t + 11_000)
  const [pb] = await B.h.prompts()
  const acc = await B.h.decide(pb.id, 'accept', opts(t + 12_000))
  await settle([A, B, C], acc.outbound, t + 13_000)
  const [gc] = await C.h.groups()
  const v = await C.h.vouchFor(groupId, gc.pending[0].member, opts(t + 14_000))
  assert.equal(v.ok, true)
  const sA = await A.read()
  const ownA = await labeledContext(A.seed, sA.groups[groupId].memberLabel)
  const ctxC = await labeledContext(C.seed, (await C.read()).groups[groupId].memberLabel)
  const evidence = (await unseal(v.outbound[0].envelope, ownA.x.priv)).document
  return { A, B, C, groupId, t, acc, v, ownA, ctxC, evidence }
}
const unproved = ({ proof: _p, ...rest }) => rest

test('membership: evidence whose vouch@2 is validly signed over a foreign accept digest is refused (3810); nothing counts, nothing is admitted; the real vouch then admits', async () => {
  const { A, groupId, t, v, ownA, ctxC, evidence } = await ruleOfTwo([0x41, 0x42, 0x43])
  const vouch = evidence.payload.evidence.vouches[0]
  const e = vouch.credentialSubject.endorsement
  const foreign = await diSign(ctxC, { ...unproved(vouch), credentialSubject: { ...vouch.credentialSubject, endorsement: { ...e, accept: await digestDoc({ x: 'another accept' }) } } }, vouch.proof.created)
  const forged = { ...evidence, id: '5b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', payload: { evidence: { ...evidence.payload.evidence, vouches: [foreign] } } }
  const before = (await A.read()).groups[groupId]
  const r = await A.h.receive(await seal(forged, ownA.keyAgreement), t + 15_000)
  assert.deepEqual([r.disposition, r.stage, r.ref], ['failed', 8, 'RLTP-MT-3810'])
  assert.deepEqual((await A.read()).groups[groupId], before, 'no vouch counted, no admission, state unchanged')
  const real = await A.h.receive(v.outbound[0].envelope, t + 16_000)
  assert.ok(real.events.some((x) => x.type === 'group.admitted'), 'control: the real vouch admits')
})

test('membership: evidence from an anchor that is not on the roster is refused (3750); evidence for a group the receiver does not hold is refused (3755)', async () => {
  const { A, B, groupId, t, ownA, evidence } = await ruleOfTwo([0x44, 0x45, 0x46])
  const outsider = await pairContext(B.seed, new Uint8Array(32).fill(0x99))   // an anchor of B's, no member
  const before = (await A.read()).groups[groupId]
  const fromOutsider = { ...evidence, id: '6b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', issuer: outsider.anchor }
  const r1 = await A.h.receive(await seal(fromOutsider, ownA.keyAgreement), t + 15_000)
  assert.deepEqual([r1.disposition, r1.ref], ['failed', 'RLTP-MT-3750'])
  // the evidence pair names another group (its invite's genesis digest)
  const inv = evidence.payload.evidence.invite
  const other = { ...inv, payload: { invite: { ...inv.payload.invite, credentialSubject: { ...inv.payload.invite.credentialSubject, genesisDigest: await digestDoc({ other: 'group' }) } } } }
  const elsewhere = { ...evidence, id: '7b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', payload: { evidence: { ...evidence.payload.evidence, invite: other } } }
  const r2 = await A.h.receive(await seal(elsewhere, ownA.keyAgreement), t + 15_000)
  assert.deepEqual([r2.disposition, r2.ref], ['failed', 'RLTP-MT-3755'])
  assert.deepEqual((await A.read()).groups[groupId], before, 'state unchanged')
})

test('membership: an accept signed after validUntil + the membership skew is refused by the inviter (3270), however coherently re-signed', async () => {
  const A = await communityPerson(0x47), B = await communityPerson(0x48)
  const { groupId } = await joined(A, B)
  const [p] = await B.h.prompts()
  const d = await B.h.decide(p.id, 'accept', opts(T0 + 20_000))
  const ownA = await labeledContext(A.seed, (await A.read()).groups[groupId].memberLabel)
  const doc = (await unseal(d.outbound[0].envelope, ownA.x.priv)).document
  const ctxB = await labeledContext(B.seed, 'group/' + groupId)
  const validUntil = Object.values((await B.read()).joining.invites)[0].validUntil
  const late = iso(validUntil + 5 * 60_000 + 60_000)   // past validUntil + PT5M
  const forged = await diSign(ctxB, { ...unproved(doc), id: '8b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d', issuedAt: late }, late)
  const r = await A.h.receive(await seal(forged, ownA.keyAgreement), Date.parse(late))
  assert.deepEqual([r.disposition, r.ref], ['failed', 'RLTP-MT-3270'])
  assert.equal(Object.keys((await A.read()).groups[groupId].roster).length, 1, 'nothing admitted')
})

// ── the re-match on join opens the stored sealed pairs (5530–5570) ──────

/** A founds G and switches the sealed group star on toward B for G; A's group star reaches B before B joins. */
async function sealedBeforeJoin (fa, fb) {
  const A = await communityPerson(fa), B = await communityPerson(fb)
  const { a, b } = await met(A, B)
  const f = await A.h.foundGroup({ name: 'Garden' }, opts(T0 + 10_000))
  const groupId = ev(f, 'group.founded')[0].groupId
  assert.equal((await A.h.setGroupClass(a.id, groupId, 'on', opts(T0 + 10_500))).ok, true)
  await settle([A, B], [], T0 + 11_000)
  const tB = () => B.read().then((s) => Object.values(s.relationships).flatMap((r) => r.tuples).find((t) => t.groupStarIn.accepted))
  assert.ok(await tB(), 'B accepted A\'s group star before joining')
  return { A, B, a, b, groupId, tB }
}
const join = async (A, B, a, groupId, t) => {
  await settle([A, B], (await A.h.invite(groupId, a.id, opts(t))).outbound, t + 1000)
  const [p] = await B.h.prompts()
  return settle([A, B], (await B.h.decide(p.id, 'accept', opts(t + 2000))).outbound, t + 3000)
}
const membersOf = async (P, contactId) => {
  const s = await P.read()
  const rel = s.relationships[(await P.h.contact(contactId)).relationships[0].id]
  return rel.memory.groupMembers ?? {}
}

test('membership: on joining, the sealed pair of a group star accepted before is opened and checked against the joined group (5530–5570) and its member taken into the relationship\'s memory (5580)', async () => {
  const { A, B, a, b, groupId } = await sealedBeforeJoin(0x31, 0x32)
  assert.deepEqual(await membersOf(B, b.id), {}, 'nothing taken before the join')
  await join(A, B, a, groupId, T0 + 12_000)
  assert.deepEqual((await B.h.contact(b.id)).sharedGroups, [groupId])
  const g = (await A.read()).groups[groupId]
  assert.deepEqual((await membersOf(B, b.id))[groupId], { member: g.memberAnchor, memberOp: g.memberOp }, 'the sender\'s member, from the stored pair')
})

test('membership: a stored sealed pair that fails 5560 against the joined group is not taken — the hit counts, the member does not', async () => {
  const { A, B, a, b, groupId, tB } = await sealedBeforeJoin(0x33, 0x34)
  // the stored star is replaced by one whose sealed pair names a member the
  // group's roster will not hold (the MAC and the AEAD are sound)
  const t = await tB()
  const sB = await B.read()
  const ownB = await labeledContext(B.seed, t.ownPairLabel)
  const shared = await ecdh(ownB.x.priv, xRawOfMk(t.counterpartKeyAgreement))
  const stranger = await pairContext(A.seed, new Uint8Array(32).fill(0x55))
  const salt = t.groupStarIn.accepted.salt
  let n = 0
  const draw = (k) => { const out = new Uint8Array(k); for (let i = 0; i < k; i++) out[i] = (n * 31 + i * 7 + 1) & 0xff; n++; return out }
  const { chunks } = await buildGroupStarWith({
    shared, sender: t.counterpartAnchor, to: ownB.anchor, salt, draw,
    groups: [{ group: groupId, sealed: true, member: stranger.anchor, memberOp: oidOf(groupId), memberShared: async () => ecdh(stranger.x.priv, xRawOfMk(ownB.keyAgreement)) }],
  })
  await edit(B, (s) => {
    for (const r of Object.values(s.relationships)) for (const x of r.tuples) if (x.ownPairLabel === t.ownPairLabel) x.groupStarIn.accepted.entries = chunks.flatMap((c) => c.body.groups)
  })
  void sB
  await join(A, B, a, groupId, T0 + 12_000)
  assert.deepEqual((await B.h.contact(b.id)).sharedGroups, [groupId], 'the blinded hit is the contact\'s claim (5520)')
  assert.deepEqual(await membersOf(B, b.id), {}, 'the pair naming a non-member is not taken (5560)')
})

test('membership: a welcome whose roster carries an anchor or an op twice is refused at its form check (validation-failed, stage 8): the re-match and the materialised roster never read two admissions of one member', async () => {
  const A = await communityPerson(0x35), B = await communityPerson(0x36)
  const { groupId } = await joined(A, B)
  const [p] = await B.h.prompts()
  const d = await B.h.decide(p.id, 'accept', opts(T0 + 20_000))
  const got = await A.h.receive(d.outbound[0].envelope, T0 + 21_000)
  const welcome = got.outbound.find((o) => o.type === WELCOME)
  const memberB = await labeledContext(B.seed, 'group/' + groupId)
  const doc = (await unseal(welcome.envelope, memberB.x.priv)).document
  const actx = await labeledContext(A.seed, (await A.read()).groups[groupId].memberLabel)
  const other = await pairContext(A.seed, new Uint8Array(32).fill(0x66))
  const resign = async (roster, id) => diSign(actx, { ...unproved(doc), id, payload: { ...doc.payload, roster } }, doc.issuedAt)
  const founder = doc.payload.roster.find((m) => m.anchor === actx.anchor)
  // the founder's anchor twice, the second with another op and key
  const twice = await resign([...doc.payload.roster, { ...founder, op: oidOf(await digestDoc({ x: 'other admission' })), keyAgreement: other.keyAgreement }], '9b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d')
  const r1 = await B.h.receive(await seal(twice, memberB.keyAgreement), T0 + 22_000)
  assert.deepEqual([r1.disposition, r1.reason, r1.stage], ['failed', 'validation-failed', 8])
  // one op naming two anchors
  const opTwice = await resign([...doc.payload.roster, { anchor: other.anchor, op: founder.op, keyAgreement: other.keyAgreement }], 'ab9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d')
  const r2 = await B.h.receive(await seal(opTwice, memberB.keyAgreement), T0 + 22_000)
  assert.deepEqual([r2.disposition, r2.reason, r2.stage], ['failed', 'validation-failed', 8])
  assert.deepEqual(await B.h.groups(), [], 'nothing joined')
  // the real welcome joins
  const r3 = await B.h.receive(welcome.envelope, T0 + 23_000)
  assert.deepEqual(r3.events.map((e) => e.type), ['group.joined'])
})

// ── identity renames during an open invitation (Trust 2140, 2080, 2260) ──

/** B holds the prelude bound to its contact for A; A invites again into the same group. */
const inviteAgain = async (A, B, groupId, aId, t) => {
  const inv = await A.h.invite(groupId, aId, opts(t))
  assert.equal(inv.ok, true, JSON.stringify(inv))
  const seen = await settle([A, B], inv.outbound, t + 1000)
  const pre = seen.find((x) => x.o.type === TT + 'membership-prelude-request/0.1')
  return { pre, prompts: (await B.h.prompts()).filter((p) => p.kind === 'group-invite') }
}
const preludeContacts = async (P) => Object.values((await P.read()).joining.preludes).map((p) => p.contactId)

test('membership: the inviter\'s contact merged by hand into another entry during an open invitation — the binding follows the merge, a new invitation on the same channel is taken (2140)', async () => {
  const A = await communityPerson(0x91), B = await communityPerson(0x92), D = await communityPerson(0x93)
  const { a, b, groupId } = await joined(A, B)
  const { b: bd } = await met(D, B, T0 + 50_000)
  const m = await B.h.merge([b.id, bd.id], opts(T0 + 60_000))
  assert.equal(m.ok, true, JSON.stringify(m))
  const merged = (await B.h.contact(b.id)).id
  assert.deepEqual(await preludeContacts(B), [merged], 'the prelude binding names the merged entry')
  const { pre, prompts } = await inviteAgain(A, B, groupId, a.id, T0 + 70_000)
  assert.equal(pre.got.disposition, 'unique', JSON.stringify(pre.got))
  assert.equal(prompts.length, 2, 'the second invitation surfaces')
  assert.ok(prompts.every((p) => p.contactId === merged))
})

test('membership: a hand-merged entry split by the first mapping of the other relationship during an open invitation — the binding stays with the inviter\'s channel (2080)', async () => {
  const A = await communityPerson(0x94), B = await communityPerson(0x95), D = await communityPerson(0x96)
  const { a, b } = await met(A, B)
  // A's mapping gives B an entry for A
  assert.equal((await A.h.trust(a.id, opts(T0 + 20_000))).ok, true)
  await settle([A, B], [], T0 + 21_000)
  const { a: da, b: bd } = await met(D, B, T0 + 50_000)
  assert.equal((await B.h.merge([b.id, bd.id], opts(T0 + 60_000))).ok, true, 'one entry and an unmapped relationship merge by hand (6640)')
  assert.equal((await B.h.contacts()).length, 1)
  const f = await A.h.foundGroup({ name: 'Garden' }, opts(T0 + 61_000))
  const groupId = ev(f, 'group.founded')[0].groupId
  await settle([A, B], (await A.h.invite(groupId, a.id, opts(T0 + 62_000))).outbound, T0 + 63_000)
  // D's first mapping names no anchor of the entry: D's relationship leaves (2080)
  assert.equal((await D.h.trust(da.id, opts(T0 + 64_000))).ok, true)
  await settle([D, B], [], T0 + 65_000)
  assert.equal((await B.h.contacts()).length, 2, 'split: two entries')
  const atA = (await B.h.contacts()).find((c) => c.trust.received && c.relationships.some((r) => r.id === b.relationships[0].id))
  const { pre, prompts } = await inviteAgain(A, B, groupId, a.id, T0 + 70_000)
  assert.equal(pre.got.disposition, 'unique', JSON.stringify(pre.got))
  assert.equal(prompts.length, 2)
  assert.deepEqual([...new Set(prompts.map((p) => p.contactId))], [atA.id], 'both invitations name the inviter\'s entry')
  assert.deepEqual(await preludeContacts(B), [atA.id])
})

/** B's entry for A (A mapped B) and B's relationship to D, not yet merged;
 *  the split of their merge comes with D's first mapping (2080). */
async function mergedAD (A, B, D, t) {
  const { a, b } = await met(A, B, t)
  assert.equal((await A.h.trust(a.id, opts(t + 20_000))).ok, true)
  await settle([A, B], [], t + 21_000)
  const { a: da, b: bd } = await met(D, B, t + 30_000)
  return { a, b, da, bd }
}
const splitByD = async (B, D, da, t) => {
  assert.equal((await D.h.trust(da.id, opts(t))).ok, true)
  await settle([D, B], [], t + 1000)
  assert.equal((await B.h.contacts()).length, 2, 'split: two entries')
}
const entryOfRel = async (P, relId) => (await P.h.contacts()).find((c) => c.relationships.some((r) => r.id === relId)).id

test('membership: a hand-merged entry split while both its counterparts\' invitations are open at the invitee — each invite and its prompt name the entry of the relationship its prelude arrived on, either side of the split (2080)', async () => {
  const A = await communityPerson(0x31), B = await communityPerson(0x32), D = await communityPerson(0x33)
  const { a, b, da, bd } = await mergedAD(A, B, D, T0)
  assert.equal((await B.h.merge([b.id, bd.id], opts(T0 + 40_000))).ok, true)
  const gA = ev(await A.h.foundGroup({ name: 'Garden' }, opts(T0 + 41_000)), 'group.founded')[0].groupId
  const gD = ev(await D.h.foundGroup({ name: 'Orchard' }, opts(T0 + 41_000)), 'group.founded')[0].groupId
  await settle([A, B], (await A.h.invite(gA, a.id, opts(T0 + 42_000))).outbound, T0 + 43_000)
  await settle([D, B], (await D.h.invite(gD, da.id, opts(T0 + 44_000))).outbound, T0 + 45_000)
  const merged = (await B.h.contact(b.id)).id
  assert.deepEqual((await B.h.prompts()).map((p) => p.contactId), [merged, merged])
  await splitByD(B, D, da, T0 + 46_000)
  const atA = await entryOfRel(B, b.relationships[0].id), atD = await entryOfRel(B, bd.relationships[0].id)
  assert.notEqual(atA, atD)
  const s = await B.read()
  const byGroup = (g) => Object.values(s.joining.invites).find((i) => i.group === g)
  assert.equal(byGroup(gA).contactId, atA, 'the invite whose prelude came from A stays with A\'s entry')
  assert.equal(byGroup(gD).contactId, atD, 'the invite whose prelude came from D goes with D\'s relationship')
  const prompts = await B.h.prompts()
  assert.equal(prompts.find((p) => p.groupId === gA).contactId, atA)
  assert.equal(prompts.find((p) => p.groupId === gD).contactId, atD, 'the group-invite prompt follows its invite')
  // the accept goes to D's group on D's relationship and joins
  const pd = prompts.find((p) => p.groupId === gD)
  const r = await settle([D, B], (await B.h.decide(pd.id, 'accept', opts(T0 + 48_000))).outbound, T0 + 49_000)
  assert.ok(r.some((x) => x.o.type === WELCOME && x.got.events?.some((e) => e.type === 'group.joined')))
  const g = (await B.read()).groups[gD]
  assert.equal(Object.values(g.roster).find((m) => m.contactId !== undefined).contactId, atD, 'the inviter on the roster is D\'s entry')
})

test('membership: a hand-merged entry split after the invitee accepted, its accept not yet delivered — the accept\'s outbox item and the invite\'s stored ack, both on the member key, name the entry of the relationship the prelude came on (2080)', async () => {
  const A = await communityPerson(0x37), B = await communityPerson(0x38), D = await communityPerson(0x39)
  const { b, da, bd } = await mergedAD(A, B, D, T0)
  assert.equal((await B.h.merge([b.id, bd.id], opts(T0 + 40_000))).ok, true)
  const gD = ev(await D.h.foundGroup({ name: 'Orchard' }, opts(T0 + 41_000)), 'group.founded')[0].groupId
  await settle([D, B], (await D.h.invite(gD, da.id, opts(T0 + 42_000))).outbound, T0 + 43_000)
  const merged = (await B.h.contact(b.id)).id
  const [p] = await B.h.prompts()
  const d = await B.h.decide(p.id, 'accept', opts(T0 + 44_000))
  assert.deepEqual(d.outbound.map((o) => o.type), [ACCEPT])
  const digest = d.outbound[0].digest
  const s0 = await B.read()
  const memberKey = Object.entries(s0.addresses.keys).find(([, k]) => k.label === 'group/' + gD)[0]
  const acks = (s) => Object.values(s.effects).filter((e) => e.ack && e.ack.recipient.rkid === memberKey).map((e) => e.ack.recipient.contactId)
  assert.equal(s0.outbox[digest].recipient.contactId, merged)
  assert.ok(acks(s0).length > 0 && acks(s0).every((c) => c === merged), 'the invite\'s ack names the merged entry')
  // the split comes before the accept is delivered
  assert.equal((await D.h.trust(da.id, opts(T0 + 45_000))).ok, true)
  const mapping = (await D.h.resume(T0 + 45_000)).outbound
  for (const o of mapping) await B.h.receive(o.envelope, T0 + 45_500)
  assert.equal((await B.h.contacts()).length, 2, 'split: two entries')
  const atD = await entryOfRel(B, bd.relationships[0].id)
  assert.notEqual(atD, merged)
  const s1 = await B.read()
  assert.equal(s1.outbox[digest].recipient.contactId, atD, 'the accept follows D\'s relationship')
  assert.equal(s1.outbox[digest].recipient.rkid, memberKey, 'still on the member key')
  assert.deepEqual(s1.outbox[digest].envelope, s0.outbox[digest].envelope, 'the sealed envelope is untouched')
  assert.ok(acks(s1).every((c) => c === atD), 'the invite\'s stored ack follows D\'s relationship')
  assert.equal((await B.h.deliveryStatus(digest)).items[0].contactId, atD, 'deliveryStatus names D\'s entry')
  // and the accept, sent now, still joins
  const r = await settle([D, B], d.outbound, T0 + 46_000)
  assert.ok(r.some((x) => x.o.type === WELCOME && x.got.events?.some((e) => e.type === 'group.joined')))
})

test('membership: a hand-merged entry split while the inviter holds invitations and members of both its relationships — each invitation and roster entry names the entry of the relationship its prelude went on, either side of the split (2080)', async () => {
  const A = await communityPerson(0x34), B = await communityPerson(0x35), D = await communityPerson(0x36)
  // here B invites: A and D, each into two groups; one invitation each is accepted
  const { b, da, bd } = await mergedAD(A, B, D, T0)
  const gOpen = ev(await B.h.foundGroup({ name: 'Garden' }, opts(T0 + 40_000)), 'group.founded')[0].groupId
  const gIn = ev(await B.h.foundGroup({ name: 'Orchard' }, opts(T0 + 40_500)), 'group.founded')[0].groupId
  let t = T0 + 41_000
  for (const [P, c] of [[A, b], [D, bd]]) {
    for (const g of [gOpen, gIn]) { await settle([P, B], (await B.h.invite(g, c.id, opts(t))).outbound, t + 500); t += 1000 }
    const p = (await P.h.prompts()).find((x) => x.kind === 'group-invite' && x.groupId === gIn)
    const r = await settle([P, B], (await P.h.decide(p.id, 'accept', opts(t))).outbound, t + 500)
    assert.ok(r.some((x) => x.got.events?.some((e) => e.type === 'group.joined')))
    t += 1000
  }
  const memA = (await A.read()).groups[gIn].memberAnchor, memD = (await D.read()).groups[gIn].memberAnchor
  assert.equal((await B.h.merge([b.id, bd.id], opts(t))).ok, true)
  const merged = (await B.h.contact(b.id)).id
  const s0 = (await B.read()).groups
  assert.deepEqual(Object.values(s0[gOpen].invitations).map((i) => i.contactId), [merged, merged])
  assert.deepEqual([s0[gIn].roster[memA].contactId, s0[gIn].roster[memD].contactId], [merged, merged])
  await splitByD(B, D, da, t + 1000)
  const atA = await entryOfRel(B, b.relationships[0].id), atD = await entryOfRel(B, bd.relationships[0].id)
  assert.notEqual(atA, atD)
  const gs = (await B.read()).groups
  const invitee = async (P) => (await labeledContext(P.seed, 'group/' + gOpen)).anchor
  const inv = (x) => Object.values(gs[gOpen].invitations).find((i) => i.invitee === x)
  assert.equal(inv(await invitee(A)).contactId, atA, 'the invitation to A stays with A\'s entry')
  assert.equal(inv(await invitee(D)).contactId, atD, 'the invitation to D goes with D\'s relationship')
  assert.equal(gs[gIn].roster[memA].contactId, atA, 'A on the roster stays with A\'s entry')
  assert.equal(gs[gIn].roster[memD].contactId, atD, 'D on the roster goes with D\'s relationship')
})

test('membership: the inviter departed during an open invitation and met again — the old binding does not block the new channel (2260)', async () => {
  const A = await communityPerson(0x97), B = await communityPerson(0x98)
  const { b, groupId } = await joined(A, B)
  assert.equal((await B.h.depart(b.id, opts(T0 + 40_000))).ok, true)
  const again = await met(A, B, T0 + 50_000)
  const { pre, prompts } = await inviteAgain(A, B, groupId, again.a.id, T0 + 60_000)
  assert.equal(pre.got.disposition, 'unique', JSON.stringify(pre.got))
  assert.ok(prompts.some((p) => p.contactId === again.b.id), 'the new invitation names the new contact')
})

test('M3: a re-encounter chains away the tuple an answered prelude travelled on, its key older than key-retention; tick keeps it while the prelude is held, and the join still completes', async () => {
  const DAY = 86_400_000
  const TL = T0 + 100 * DAY
  const A = await communityPerson(0x6a), B = await communityPerson(0x6b)
  const { a } = await met(A, B, T0)
  const f = await A.h.foundGroup({ name: 'Garden' }, opts(TL))
  const groupId = ev(f, 'group.founded')[0].groupId
  const inv = await A.h.invite(groupId, a.id, opts(TL + 1000))
  assert.equal(inv.ok, true, JSON.stringify(inv))
  await settle([A, B], inv.outbound, TL + 2000)
  const [pre] = Object.values((await B.read()).joining.preludes)
  // A and B meet again: the fresh tuples chain, the prelude's tuple is deactivated (6220)
  await met(A, B, TL + 3000)
  await settle([A, B], [], TL + 4000)
  const byRkid = (s, rkid) => Object.values(s.relationships).flatMap((r) => r.tuples).find((t) => t.rkid === rkid)
  assert.equal(byRkid(await B.read(), pre.rkid).deactivated, true)
  await B.h.tick(TL + 5000)
  const sB = await B.read()
  assert.equal(sB.addresses.tombstones.includes(pre.rkid), false, 'the prelude\'s tuple key is kept')
  assert.ok(Object.hasOwn(sB.addresses.keys, pre.rkid))
  const prompt = (await B.h.prompts()).find((p) => p.kind === 'group-invite')
  const d = await B.h.decide(prompt.id, 'accept', opts(TL + 6000))
  assert.equal(d.ok, true, JSON.stringify(d))
  const r = await settle([A, B], d.outbound, TL + 7000)
  assert.ok(r.some((x) => x.o.type === WELCOME && x.got.events?.some((e) => e.type === 'group.joined')))
})

test('M4: a prelude request and a prelude reply are refused on a tuple a chaining deactivated (6190, 6240)', async () => {
  const onDeactivated = async (P, o) => Object.values((await P.read()).relationships).flatMap((r) => r.tuples).find((t) => t.rkid === o.envelope.rkid)?.deactivated
  // the request: A and B meet again before it arrives
  {
    const A = await communityPerson(0x6c), B = await communityPerson(0x6d)
    const { a } = await met(A, B, T0)
    const groupId = ev(await A.h.foundGroup({ name: 'Garden' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
    const inv = await A.h.invite(groupId, a.id, opts(T0 + 11_000))
    assert.equal(inv.ok, true, JSON.stringify(inv))
    await met(A, B, T0 + 12_000)
    for (const o of inv.outbound) {
      assert.equal(await onDeactivated(B, o), true)
      const r = await B.h.receive(o.envelope, T0 + 17_000)
      assert.deepEqual([r.disposition, r.ref], ['failed', 'RLTP-TRU-6240'], o.type)
    }
    assert.deepEqual((await B.read()).joining.preludes, {}, 'no prelude answered')
  }
  // the reply: B answered, A and B meet again before the answer arrives
  {
    const A = await communityPerson(0x6e), B = await communityPerson(0x6f)
    const { a } = await met(A, B, T0)
    const groupId = ev(await A.h.foundGroup({ name: 'Garden' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
    const inv = await A.h.invite(groupId, a.id, opts(T0 + 11_000))
    const got = await B.h.receive(inv.outbound[0].envelope, T0 + 11_500)
    assert.equal(got.disposition, 'unique')
    const replies = got.outbound.filter((o) => o.type.endsWith('/membership-prelude-reply/0.1'))
    assert.equal(replies.length, 1)
    await met(A, B, T0 + 12_000)
    assert.equal(await onDeactivated(A, replies[0]), true)
    const r = await A.h.receive(replies[0].envelope, T0 + 17_000)
    assert.deepEqual([r.disposition, r.ref], ['failed', 'RLTP-TRU-6240'])
    assert.equal(Object.keys((await A.read()).groups[groupId].preludes).length, 1, 'the prelude stays unanswered')
  }
})

// ── Membership 0.20: the prelude as registered types, the binding per relationship, the admission bound ──

import { readFileSync } from 'node:fs'
import { preludeRequestProblem, PRELUDE_REQUEST_TYPE, PRELUDE_REPLY_TYPE } from '../dist/membership.js'
import { createHolder, seedKeys, digestBytes } from '../dist/index.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'

const VEC = JSON.parse(readFileSync(new URL('../../vectors/membership-tasks.json', import.meta.url), 'utf8'))

test('membership 0.20: the prelude request vector cases — the registered form, the binding fields against payload and document, the binding proof, the document proof (RLTP-MT-3900, 3905)', async () => {
  assert.equal(PRELUDE_REQUEST_TYPE, TT + 'membership-prelude-request/0.1')
  assert.equal(PRELUDE_REPLY_TYPE, TT + 'membership-prelude-reply/0.1')
  assert.equal(VEC.prelude.request.type, PRELUDE_REQUEST_TYPE)
  assert.equal(await preludeRequestProblem(VEC.prelude.request), null)
  assert.equal(VEC.preludeRequestCases.length, 6)
  for (const c of VEC.preludeRequestCases) {
    const got = await preludeRequestProblem(c.artifact)
    assert.equal(got, c.fails[0] ?? null, c.name)
    assert.equal(got === null ? 'accepted' : 'failed(validation-failed)', c.expected, c.name)
  }
  // genesis digests compare by their decoded bytes (3905): the binding's in z, the payload's in u
  const inviter = await labeledContext(new Uint8Array(64).fill(0x5c), 'pair/' + await digestBytes(new Uint8Array(32).fill(1)))
  const sender = await labeledContext(new Uint8Array(64).fill(0x5d), 'pair/' + await digestBytes(new Uint8Array(32).fill(2)))
  const u = VEC.prelude.request.payload.genesisDigest
  const bytes = Buffer.from(u.slice(1), 'base64url')
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt('0x' + bytes.toString('hex')), z = ''
  while (n > 0n) { z = B58[Number(n % 58n)] + z; n /= 58n }
  z = 'z' + z
  const at = '2026-09-01T09:50:00Z', threadId = 'c17f9c80-e3a4-4d01-a273-8e9fa0b1c2d3'
  const binding = await diSign(inviter, { type: 'membership-inviter@1', inviter: inviter.anchor, genesisDigest: z, threadId, from: sender.anchor, to: VEC.prelude.request.recipient }, at)
  const doc = await diSign(sender, { id: VEC.prelude.request.id, type: PRELUDE_REQUEST_TYPE, issuer: sender.anchor, recipient: VEC.prelude.request.recipient, threadId, issuedAt: at, payload: { genesisDigest: u, group: VEC.prelude.request.payload.group, name: 'Bytes', inviter: inviter.anchor, binding } }, at)
  assert.equal(await preludeRequestProblem(doc), null, 'z and u renderings of one digest are one genesis digest')
})

/** Two holders A and B holding two relationships toward each other (r1, r2:
 *  two tuples under two pair labels, never chained), entries c1 and c2. */
async function twoRelationships () {
  const seedA = new Uint8Array(64).fill(0xa7), seedB = new Uint8Array(64).fill(0xb9)
  const kA = seedKeys(seedA), kB = seedKeys(seedB)
  const lab = async (n) => 'pair/' + await digestBytes(new Uint8Array(32).fill(n))
  const [la1, la2, lb1, lb2] = await Promise.all([lab(0x13), lab(0x14), lab(0x15), lab(0x16)])
  const [a1, a2, b1, b2] = await Promise.all([kA.anchorOf(la1), kA.anchorOf(la2), kB.anchorOf(lb1), kB.anchorOf(lb2)])
  const build = (ownL, own, them) => stateBuilder({ at: T0 })
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: ownL[0], counterpartAnchor: them[0].anchor, counterpartKeyAgreement: them[0].keyAgreement, rkid: own[0].keyAgreement }] })
    .relationship('r2', { contactId: 'c2', tuples: [{ ownPairLabel: ownL[1], counterpartAnchor: them[1].anchor, counterpartKeyAgreement: them[1].keyAgreement, rkid: own[1].keyAgreement }] })
    .entry('c1').entry('c2').settings('c1', { star: 'off', groupStar: 'off' }).settings('c2', { star: 'off', groupStar: 'off' }).build()
  const sA = new InMemoryStore(), sB = new InMemoryStore()
  await sA.commit(null, build([la1, la2], [a1, a2], [b1, b2]))
  await sB.commit(null, build([lb1, lb2], [b1, b2], [a1, a2]))
  const mk = async (store, keys, seed) => ({ h: await createHolder({ store, keys }, { invariants: true }), store, keys, seed, read: async () => (await store.read()).state })
  return { A: await mk(sA, kA, seedA), B: await mk(sB, kB, seedB) }
}

test('membership 0.20: one binding per relationship — a request from another relationship is refused while the bound one is current (3935), a renewal on the bound relationship replaces its tuple (3930), and after the bound relationship ended the other one takes the key (3935)', async () => {
  const { A, B } = await twoRelationships()
  const gid = ev(await A.h.foundGroup({ name: 'Two ways' }, opts(T0 + 1000)), 'group.founded')[0].groupId
  const bound = async () => Object.values((await B.read()).joining.preludes).filter((p) => p.group === gid)
  // the request on r1 binds (3925)
  const i1 = await A.h.invite(gid, 'c1', opts(T0 + 2000))
  const g1 = await B.h.receive(i1.outbound[0].envelope, T0 + 2100)
  assert.equal(g1.disposition, 'unique', JSON.stringify(g1))
  assert.deepEqual((await bound()).map((p) => p.contactId), ['c1'])
  const r1Rkid = (await bound())[0].rkid
  // the same member asks through r2 while r1 is current: refused (3935)
  const i2 = await A.h.invite(gid, 'c2', opts(T0 + 3000))
  const g2 = await B.h.receive(i2.outbound[0].envelope, T0 + 3100)
  assert.deepEqual([g2.disposition, g2.reason, g2.ref], ['failed', 'validation-failed', 'RLTP-MT-3935'])
  assert.deepEqual((await bound()).map((p) => [p.contactId, p.rkid]), [['c1', r1Rkid]], 'the binding stays on r1')
  // a renewal on r1 replaces the binding's tuple (3930): accepted, still r1
  const i3 = await A.h.invite(gid, 'c1', opts(T0 + 4000))
  assert.equal((await B.h.receive(i3.outbound[0].envelope, T0 + 4100)).disposition, 'unique')
  assert.deepEqual((await bound()).map((p) => [p.contactId, p.rkid, p.at]), [['c1', r1Rkid, T0 + 4100]])
  // the invitation that follows is attributed to r1's contact
  await settle([A, B], [], T0 + 5000)
  // r1 ends: B departs from c1; now r2 takes the key (3935, second sentence)
  assert.equal((await B.h.depart('c1', opts(T0 + 6000))).ok, true)
  const i4 = await A.h.invite(gid, 'c2', opts(T0 + 7000))
  const g4 = await B.h.receive(i4.outbound[0].envelope, T0 + 7100)
  assert.equal(g4.disposition, 'unique', JSON.stringify(g4))
  assert.deepEqual((await bound()).map((p) => p.contactId), ['c2'], 'the binding moved to the current relationship')
  // the invitation surfaces as c2's
  await settle([A, B], g4.outbound, T0 + 8000)
  const prompts = (await B.h.prompts()).filter((p) => p.kind === 'group-invite')
  assert.ok(prompts.some((p) => p.contactId === 'c2'), JSON.stringify(prompts))
})

test('membership 0.20: the inviter admits on its own invitation only before validUntil + skew + the longest horizon (RLTP-MT-3282) — on the evidence path at the bound − 1 it admits, at the bound it leaves the consent as evidence (review 109-1 #3)', async () => {
  for (const [fills, offset, admits] of [[[0x81, 0x82, 0x83], 0, false], [[0x84, 0x85, 0x86], -1, true]]) {
    const { A, groupId, v } = await ruleOfTwo(fills)
    const [inv] = Object.values((await A.read()).groups[groupId].invitations)
    const bound = inv.validUntil + 300_000 + 90 * 86_400_000
    // no tick before: the invitation and the evidence are still held
    const got = await A.h.receive(v.outbound[0].envelope, bound + offset)
    assert.equal(got.disposition, 'unique', JSON.stringify(got))
    assert.equal(got.events.some((e) => e.type === 'group.admitted'), admits, `at the bound ${offset >= 0 ? '+' : ''}${offset}`)
    assert.equal((await A.h.groups())[0].pending.length, admits ? 0 : 1, 'without the admission the consent stays as evidence')
  }
})

test('membership 0.20: on the accept path the bound of RLTP-MT-3282 holds alike — an accept signed in time but arriving at the bound is recorded, not admitted (review 109-1 #3)', async () => {
  const A = await communityPerson(0x87), B = await communityPerson(0x88)
  const { groupId } = await joined(A, B)
  const [p] = await B.h.prompts()
  const acc = await B.h.decide(p.id, 'accept', opts(T0 + 20_000))
  const [inv] = Object.values((await A.read()).groups[groupId].invitations)
  const bound = inv.validUntil + 300_000 + 90 * 86_400_000
  const got = await A.h.receive(acc.outbound[0].envelope, bound)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  assert.deepEqual(got.events.filter((e) => e.type === 'group.admitted'), [])
  assert.equal((await A.h.groups())[0].pending.length, 1)
})

test('membership 0.20: a binding renewed onto a newer tuple after a chaining keeps resting on the invitation accepted under its key — a departure leaves it in place while that invitation is accepted (RLTP-MT-3930, 3945; review 109-1 #1)', async () => {
  const A = await communityPerson(0x89), B = await communityPerson(0x8a)
  const { a, b, groupId } = await joined(A, B)
  const [p] = await B.h.prompts()
  assert.equal((await B.h.decide(p.id, 'accept', opts(T0 + 20_000))).ok, true)   // accepted; the accept is never delivered
  // A and B meet again: the chaining; A asks again, its request reaches B, the answer never reaches A
  await met(A, B, T0 + 30_000)
  const again = await A.h.invite(groupId, a.id, opts(T0 + 40_000))
  assert.equal(again.ok, true, JSON.stringify(again))
  assert.equal((await B.h.receive(again.outbound[0].envelope, T0 + 41_000)).disposition, 'unique')
  const bindings = async () => Object.values((await B.read()).joining.preludes).filter((x) => x.group === groupId)
  const [renewed] = await bindings()
  const [accepted] = Object.values((await B.read()).joining.invites)
  assert.equal(accepted.status, 'accepted')
  assert.notEqual(renewed.rkid, accepted.rkid, 'the binding moved to the newer tuple; the accepted invitation names the older one')
  // B departs from A; the accepted invitation still rests on the binding
  assert.equal((await B.h.depart(b.id, opts(T0 + 50_000))).ok, true)
  await B.h.tick(T0 + 60_000)
  assert.equal((await bindings()).length, 1, 'the binding stays while an invitation under its key is accepted (3945)')
})

test('membership 0.20: an answered prelude\'s tuple key, deactivated by a chaining, leaves in the one tick at the deadline tick announced (the timer contract; review 109-1 #2)', async () => {
  const A = await communityPerson(0x8b), B = await communityPerson(0x8c)
  const { a } = await met(A, B)
  const gid = ev(await A.h.foundGroup({ name: 'Keys' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
  const inv = await A.h.invite(gid, a.id, opts(T0 + 11_000))
  const answered = await B.h.receive(inv.outbound[0].envelope, T0 + 11_500)
  assert.equal(answered.disposition, 'unique')
  const old = inv.outbound[0].envelope.rkid
  await met(A, B, T0 + 20_000)
  const sB = await B.read()
  assert.ok(Object.values(sB.relationships).flatMap((r) => r.tuples).find((t) => t.rkid === old).deactivated, 'the prelude\'s tuple is deactivated')
  const deadline = Object.values(sB.joining.preludes)[0].at + 24 * 3_600_000 + 300_000 + 90 * 86_400_000 + 1
  const r = await B.h.resume(deadline - 1)
  assert.ok(r.nextDueAt !== undefined && r.nextDueAt <= deadline, `the deadline is announced (${r.nextDueAt} vs ${deadline})`)
  await B.h.tick(deadline)
  const after = await B.read()
  assert.ok(!Object.hasOwn(after.addresses.keys, old), 'the key left in that tick')
  assert.ok(after.addresses.tombstones.includes(old), 'as a tombstone (a pair key, Delivery §5)')
})

test('membership 0.20 (CodeRabbit on #109): an outbox item of lib 0.4.0\'s prelude form, still held in a codec-1 state, takes its signed ack — delivered, not validation-failed', async () => {
  const A = await communityPerson(0x8d), B = await communityPerson(0x8e)
  const { a } = await met(A, B)
  const gid = ev(await A.h.foundGroup({ name: 'Legacy' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
  const inv = await A.h.invite(gid, a.id, opts(T0 + 11_000))
  const got = await B.h.receive(inv.outbound[0].envelope, T0 + 11_500)
  const ack = got.outbound.find((o) => o.type === ACK)
  // A's item as lib 0.4.0 filed it
  const { state, version } = await A.store.read()
  const s = structuredClone(state)
  s.outbox[inv.outbound[0].digest].type = TT + 'x-membership-prelude-request/0.1'
  assert.equal((await A.store.commit(version, s)).ok, true)
  const r = await A.h.receive(ack.envelope, T0 + 12_000)
  assert.equal(r.disposition, 'unique', JSON.stringify(r))
  assert.equal((await A.h.deliveryStatus(inv.outbound[0].digest)).items[0].status, 'delivered')
})
