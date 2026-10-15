#!/usr/bin/env node
// membership-holder (lib Stage 2, PR 7a): groups on the holder
// (membership/holder.ts) — found, the prelude and the invite, the accept on
// a group-invite prompt, admission and welcome, the group star between
// members through the in-library Access, vouches as evidence, decline,
// forged documents, signed acks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labeledContext, diSign, seal, unseal, iso, digestDoc, oidOf } from '../dist/index.js'
import { T0, ACK, ev, opts, settle, met, communityPerson, person } from './holder-fixture.mjs'

const TT = 'https://real-life.org/trust-tasks/'
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
