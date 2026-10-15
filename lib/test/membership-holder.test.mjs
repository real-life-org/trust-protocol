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
  const reply = await diSign(bctx, { id: crypto.randomUUID(), type: TT + 'x-membership-prelude-reply/0.1', issuer: bctx.anchor, recipient: bTuple.counterpartAnchor, threadId: thread, issuedAt: at, payload: { genesisDigest: g2, card } }, at)
  const got = await A.h.receive(await seal(reply, bTuple.counterpartKeyAgreement), T0 + 11_500)
  assert.deepEqual([got.disposition, got.reason, got.ref], ['failed', 'validation-failed', 'RLTP-MT-3030'])
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

test('membership: bounded state — evidence leaves past its invite\'s life and a horizon; an answered prelude without an invite leaves, its member key without a tombstone, and a later prelude to the same group uses the same key again (review item 9, round 2 B4)', async () => {
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
  const sB = await B.read()
  assert.ok(!Object.values(sB.joining.preludes).some((x) => x.group === g2), 'the prelude left')
  assert.equal(await rkidOf(), undefined, 'its member key left the addresses')
  assert.ok(!sB.addresses.tombstones.includes(rkid), 'without a tombstone: an identity context, not a retired address')
  // C invites B to the same group again: the same key, the invite delivered
  await C.h.tick(far)
  const again = await C.h.invite(g2, ca.id, opts(far + 1000))
  const r = await settle([B, C], again.outbound, far + 2000)
  assert.ok(r.some((x) => x.o.type === INVITE && x.got.disposition === 'unique'), 'the invite reaches the same member key')
  assert.equal(await rkidOf(), rkid)
})

test('membership: the prelude proves its claimed inviter — a contact claiming another member\'s anchor is refused, a replayed binding never overwrites the real one (round 2 B5)', async () => {
  const A = await communityPerson(0x6c), B = await communityPerson(0x6d), C = await communityPerson(0x6e)
  const { a: ab } = await met(A, B)
  await met(C, B, T0 + 5000)
  const gid = ev(await A.h.foundGroup({ name: 'Real' }, opts(T0 + 10_000)), 'group.founded')[0].groupId
  const inv = await A.h.invite(gid, ab.id, opts(T0 + 11_000))
  const pre = inv.outbound[0]
  const answered = await B.h.receive(pre.envelope, T0 + 11_500)
  assert.equal(answered.disposition, 'unique')
  // A's request as B received it
  const bLabelA = (await B.read()).addresses.keys[pre.envelope.rkid].label
  const real = (await unseal(pre.envelope, (await labeledContext(B.seed, bLabelA)).x.priv)).document
  // C's pair channel toward B
  const sC = await C.read()
  const bKeys = (await B.read()).addresses.keys
  const cTuple = Object.values(sC.relationships).flatMap((r) => r.tuples).find((t) => Object.hasOwn(bKeys, t.counterpartKeyAgreement))
  const cctx = await labeledContext(C.seed, cTuple.ownPairLabel)
  const at = iso(T0 + 12_000)
  const forge = async (payload, threadId) => seal(await diSign(cctx, { id: crypto.randomUUID(), type: TT + 'x-membership-prelude-request/0.1', issuer: cctx.anchor, recipient: cTuple.counterpartAnchor, threadId, issuedAt: at, payload }, at), cTuple.counterpartKeyAgreement)
  // a claimed inviter without its proof: C signs the binding with its own key
  const b = real.payload.binding
  const fake = await diSign(cctx, { type: b.type, inviter: b.inviter, genesisDigest: b.genesisDigest, threadId: '9b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d' }, at)
  const r1 = await B.h.receive(await forge({ ...real.payload, binding: fake }, '9b9a4c1e-2d3f-4a5b-8c6d-7e8f9a0b1c2d'), T0 + 12_000)
  assert.deepEqual([r1.disposition, r1.reason, r1.ref], ['failed', 'validation-failed', 'RLTP-MT-3020'])
  // A's real binding replayed by C on A's thread: valid, but the binding is held for A's contact
  const r2 = await B.h.receive(await forge(real.payload, real.threadId), T0 + 12_100)
  assert.deepEqual([r2.disposition, r2.reason, r2.ref], ['failed', 'validation-failed', 'RLTP-MT-3030'])
  const bound = Object.values((await B.read()).joining.preludes).find((x) => x.group === gid)
  const sB = await B.read()
  const viaA = Object.values(sB.relationships).find((r) => r.tuples.some((t) => t.rkid === pre.envelope.rkid)).contactId
  assert.equal(bound.contactId, viaA, 'still bound to the contact that asked as A')
  // A's genuine flow still binds the invite to A's contact
  await settle([A, B], answered.outbound, T0 + 13_000)
  const [p] = (await B.h.prompts()).filter((x) => x.kind === 'group-invite')
  assert.equal(p.contactId, bound.contactId)
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
