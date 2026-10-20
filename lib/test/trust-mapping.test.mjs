#!/usr/bin/env node
// trust-mapping (lib Stage 2, PR 4a; Trust 2a, 6.1–6.5, Section 2): the
// Trust act issues anchor-mapping@4 through the class-on duty, the
// counterpart verifies it under 6.3 and commits its entry; the revision
// rule, condition 8 and the lineage with its bindings on the holder.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { communityContext, labeledContext, digestBytes, jcs } from '../dist/index.js'
import { T0, MAPPING, ACK, trustPair, side, withCommunity, deliver, openFor, mappingEnvelope, craftMapping, edit, read } from './pair-fixture.mjs'

const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))

/** A trusts B, the class-on duty issues on resume; the mapping's outbound. */
async function trustAndIssue (h, when = T0, actId = 'trust-1') {
  const r = await h.act('trust.set', { contactId: 'c1', on: true }, when, { actId })
  assert.equal(r.ok, true)
  const res = await h.resume(when + 1)
  const out = res.outbound.filter((o) => o.type === MAPPING)
  assert.equal(out.length, 1)
  return out[0]
}

test('trust: A trusts B — the class-on duty issues a sealed anchor-mapping@4 on resume; B verifies, commits the entry and announces it', async () => {
  const { A, B, holderA, holderB, storeA, storeB } = await trustPair()
  const r = await holderA.act('trust.set', { contactId: 'c1', on: true }, T0, { actId: 'trust-1' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.events.map((e) => [e.type, e.contactId, e.actId]), [['trust.given', 'c1', 'trust-1']])
  assert.deepEqual(r.outbound, [], 'the act itself sends nothing: the duty does (2850)')
  let sA = await read(storeA)
  assert.deepEqual(Object.values(sA.duties), [{ kind: 'class-on', v: 1, id: 'class-on:anchorMapping:r1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' }])
  let vA = await holderA.contact('c1')
  assert.deepEqual(vA.trust, { given: true, received: false, paused: false, pending: true })
  assert.equal(vA.verification, 'met')

  const res = await holderA.resume(T0 + 1)
  const issued = res.outbound.filter((o) => o.type === MAPPING)   // beside it: the star and the group star (5.4)
  assert.equal(issued.length, 1)
  const out = issued[0]
  assert.equal(out.type, MAPPING)
  assert.deepEqual(out.recipient, { contactId: 'c1', rkid: A.keyAgreement, keyAgreement: B.keyAgreement })
  assert.equal(out.envelope.rkid, B.keyAgreement)
  sA = await read(storeA)
  assert.deepEqual(sA.duties, {})
  const tA = sA.relationships.r1.tuples[0]
  assert.equal(tA.mappingOut.rev, '1')
  assert.equal(tA.mappingOut.underAnchor, A.self)
  assert.equal(tA.mappingOut.body.self, A.self)
  assert.deepEqual(tA.mappingOut.body.lineage, [], 'nothing issued here under an earlier anchor: no lineage (6420)')
  assert.equal(sA.relationships.r1.earliestAnchor, A.self, '2285')
  vA = await holderA.contact('c1')
  assert.equal(vA.verification, 'outgoing')
  assert.equal(vA.trust.pending, false)

  // the document: proof-free, the artifact as payload (Delivery §4.4)
  const doc = await openFor(B, out.envelope)
  assert.equal(doc.type, MAPPING)
  assert.equal(doc.issuer, A.anchor)
  assert.equal(doc.recipient, B.anchor)
  assert.equal(doc.proof, undefined)
  assert.equal(jcs(doc.payload.body), jcs(tA.mappingOut.body))
  assert.equal(doc.payload.body.card.body.commit, sA.relationships.r1.tuples[0].mappingOut.body.card.body.commit)

  // B: unique, the entry commits (2060), contact.verified
  const rb = await holderB.receive(out.envelope, T0 + 2)
  assert.equal(rb.disposition, 'unique')
  assert.equal(rb.type, MAPPING)
  assert.deepEqual(rb.events.map((e) => [e.type, e.contactId, e.relationshipId]), [['trust.received', 'c1', undefined], ['contact.verified', 'c1', 'r1']])
  assert.deepEqual(rb.outbound.map((o) => o.type), [ACK])
  const sB = await read(storeB)
  const c = sB.contacts.c1
  assert.deepEqual([c.pos, c.status, c.anchorHead], ['0', 'admitted', A.self])
  assert.equal(sB.entryOrder.nextPos, '1')
  const relB = sB.relationships.r1
  assert.equal(relB.heldCounterpartHead, A.self)
  assert.deepEqual(relB.links, [])
  assert.deepEqual(Object.keys(relB.bindings), [A.self], 'card.commit is the binding of self (6610)')
  assert.deepEqual(relB.bindings[A.self], [doc.payload.body.card.body.commit])
  assert.deepEqual([relB.tuples[0].mappingIn.rev, relB.tuples[0].mappingIn.self], ['1', A.self])
  assert.equal(jcs(relB.tuples[0].mappingIn.card), jcs(doc.payload.body.card))
  const vB = await holderB.contact('c1')
  assert.equal(vB.verification, 'incoming')
  assert.deepEqual(vB.trust, { given: false, received: true, paused: false, pending: false })

  // the ack back: A's item is delivered
  const back = await holderA.receive(rb.outbound[0].envelope, T0 + 3)
  assert.equal(back.disposition, 'unique')
  assert.deepEqual(back.events.map((e) => [e.type, e.status]), [['delivery.status', 'delivered']])
  assert.equal((await holderA.deliveryStatus(out.digest)).items[0].status, 'delivered')
})

test('trust: both ways — mutual on both sides', async () => {
  const { holderA, holderB } = await trustPair()
  const outA = await trustAndIssue(holderA)
  const outB = await trustAndIssue(holderB)
  assert.equal((await deliver(holderB, [outA], T0 + 5))[0].disposition, 'unique')
  assert.equal((await deliver(holderA, [outB], T0 + 5))[0].disposition, 'unique')
  for (const h of [holderA, holderB]) {
    const v = await h.contact('c1')
    assert.equal(v.verification, 'mutual')
    assert.deepEqual(v.trust, { given: true, received: true, paused: false, pending: false })
  }
})

test('trust: the same act under the same actId replays the journal; trust.set on again is already-given', async () => {
  const { holderA, storeA } = await trustPair()
  const r1 = await holderA.act('trust.set', { contactId: 'c1', on: true }, T0, { actId: 'a1' })
  const seq = (await read(storeA)).commitSeq
  const r2 = await holderA.act('trust.set', { contactId: 'c1', on: true }, T0 + 1, { actId: 'a1' })
  const { nextDueAt, ...first } = r1
  assert.equal(nextDueAt, T0, 'the act opened a due duty')
  assert.deepEqual(r2, first, 'the replay: the journaled result; its duty cue was given then')
  assert.equal((await read(storeA)).commitSeq, seq, 'a replay commits nothing')
  assert.deepEqual(await holderA.act('trust.set', { contactId: 'c1', on: true }, T0 + 2, { actId: 'a2' }), { ok: false, code: 'already-given' })
  assert.deepEqual(await holderA.act('trust.set', { contactId: 'nope', on: true }, T0 + 2, { actId: 'a3' }), { ok: false, code: 'unknown-contact' })
  assert.deepEqual(await holderA.act('trust.set', { contactId: 'c1', on: true }, T0 + 2), { ok: false, code: 'actid-missing' })
})

test('trust: a holder without a community anchor cannot give trust (no-community)', async () => {
  const { holderA } = await trustPair({ a: (b) => b.with((s) => { s.register.community = null }) })
  assert.deepEqual(await holderA.act('trust.set', { contactId: 'c1', on: true }, T0, { actId: 'a1' }), { ok: false, code: 'no-community' })
})

test('trust: a replayed mapping envelope is duplicate-known with the byte-identical ack; it commits only the answer due, once', async () => {
  const { holderA, holderB, storeB } = await trustPair()
  const out = await trustAndIssue(holderA)
  const first = await holderB.receive(out.envelope, T0 + 2)
  const seq = (await read(storeB)).commitSeq
  const again = await holderB.receive(out.envelope, T0 + 2)
  assert.equal(again.disposition, 'duplicate-known')
  assert.deepEqual(again.outbound.map((o) => o.envelope), first.outbound.map((o) => o.envelope))
  assert.equal((await read(storeB)).commitSeq, String(BigInt(seq) + 1n))
  await holderB.receive(out.envelope, T0 + 2)
  assert.equal((await read(storeB)).commitSeq, String(BigInt(seq) + 1n), 'answered by the one due')
})

test('trust: the revision rule (6270/6280) — a resend of the same body is a repeat; lower is refused; equal with another body is an equivocation', async () => {
  const { A, B, holderB, storeB } = await trustPair()
  const m2 = await craftMapping(A, B, { revision: '2', when: T0 })
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, m2)).envelope, T0 + 1)).disposition, 'unique')
  const held = await read(storeB)
  // the same body under a new document: a repeat — acked, ignored
  const rep = await holderB.receive((await mappingEnvelope(A, B, m2)).envelope, T0 + 2)
  assert.equal(rep.disposition, 'unique')
  assert.deepEqual(rep.events, [])
  assert.deepEqual(rep.outbound.map((o) => o.type), [ACK])
  const after = await read(storeB)
  assert.equal(jcs(after.relationships), jcs(held.relationships))
  assert.equal(jcs(after.contacts), jcs(held.contacts))
  // lower
  const m1 = await craftMapping(A, B, { revision: '1', when: T0 + 5 })
  const low = await holderB.receive((await mappingEnvelope(A, B, m1)).envelope, T0 + 3)
  assert.deepEqual([low.disposition, low.reason, low.stage], ['failed', 'validation-failed', 9])
  // equal revision, another body (6280: equivocation)
  const eq = await craftMapping(A, B, { revision: '2', when: T0 + 9000 })
  const bad = await holderB.receive((await mappingEnvelope(A, B, eq)).envelope, T0 + 4)
  assert.deepEqual([bad.disposition, bad.reason, bad.stage], ['failed', 'validation-failed', 9])
  assert.equal(jcs((await read(storeB)).relationships), jcs(held.relationships), 'the current state is kept')
  // higher: in place (2070)
  const m3 = await craftMapping(A, B, { revision: '3', when: T0 + 9 })
  const up = await holderB.receive((await mappingEnvelope(A, B, m3)).envelope, T0 + 5)
  assert.equal(up.disposition, 'unique')
  assert.deepEqual(up.events.map((e) => e.type), ['contact.verified'], 'no second entry commit')
  const s = await read(storeB)
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.entryOrder.nextPos], ['0', 'admitted', '1'])
  assert.equal(s.relationships.r1.tuples[0].mappingIn.rev, '3')
})

test('trust: 6.3 conditions refuse at stage 8 — to, pair, MACs, a ceremony.enactment; nothing commits', async () => {
  const { A, B, holderB, storeB } = await trustPair()
  const C = await withCommunity(await side(0x0b, 0x0c), await digestBytes(new Uint8Array(32).fill(0x33)))
  const seq = (await read(storeB)).commitSeq
  const fail = async (env) => {
    const r = await holderB.receive(env, T0 + 1)
    assert.deepEqual([r.disposition, r.reason, r.stage], ['failed', 'validation-failed', 8])
  }
  // condition 2: addressed to another pair anchor (C's), sealed to B
  const toC = await craftMapping(A, C)
  await fail((await mappingEnvelope(A, B, toC)).envelope)
  // condition 7: a MAC flipped
  const m = await craftMapping(A, B)
  const flipped = { ...m, proof: { ...m.proof, mac2: m.proof.mac1 } }
  await fail((await mappingEnvelope(A, B, flipped)).envelope)
  // condition 3 / the closed acceptance binding: C's mapping on A's tuple
  const fromC = await craftMapping(C, B)
  await fail((await mappingEnvelope(A, B, fromC)).envelope)
  // a ceremony.enactment cannot recompute against a mapping
  await fail((await mappingEnvelope(A, B, m, { extra: { ceremony: { enactment: 'uEiAAAA' } } })).envelope)
  assert.equal((await read(storeB)).commitSeq, seq)
  // the well-formed one still verifies
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, m)).envelope, T0 + 2)).disposition, 'unique')
})

test('trust: condition 8 — a change of self without a segment that reaches the held self is refused (6170)', async () => {
  const { A, B, holderB, storeB } = await trustPair()
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, await craftMapping(A, B, { revision: '1' }))).envelope, T0 + 1)).disposition, 'unique')
  const held = await read(storeB)
  // generation 2 of A's community, but no lineage reaching generation 1
  const jump = await craftMapping(A, B, { revision: '2', gen: 2 })
  const r = await holderB.receive((await mappingEnvelope(A, B, jump)).envelope, T0 + 2)
  assert.deepEqual([r.disposition, r.reason, r.stage], ['failed', 'validation-failed', 9])
  assert.equal(jcs((await read(storeB)).relationships), jcs(held.relationships))
})

test('trust: a lineage over three generations (vectors/anchor-rotation.json) — a forged binding is refused; the re-issue after the rotation follows it', async () => {
  const ID = vec('identity-derivation.json')
  const AR = vec('anchor-rotation.json')
  const D = AR.community.genesisDigest
  const IKM = Uint8Array.from(Buffer.from(ID.rootIkm, 'hex'))
  const IKM2 = new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
  const g = AR.community.generations
  const [r12, r23] = AR.valid.map((v) => v.artifact)
  const forged = AR.negative.find((n) => n.name === 'binding-mismatch').artifact
  // A: the oracle IKM at generation 2, holding its rotation 1→2; it issued
  // on r1 under generation 1 before (2285), so the lineage starts there
  const A = await withCommunity(await side(0, 0x03, IKM), D, 2)
  assert.equal(A.self, g['2'].anchor)
  const { B, holderA, holderB, storeA, storeB } = await trustPair({
    A,
    a: (b) => b.lineage([r12]).with((s) => { s.relationships.r1.earliestAnchor = g['1'].anchor }),
  })
  const out = await trustAndIssue(holderA)
  const sent = (await read(storeA)).relationships.r1.tuples[0].mappingOut.body
  assert.deepEqual(sent.lineage, [r12], 'the segment from the earliest anchor held on r1 (6420)')
  assert.equal(sent.self, g['2'].anchor)
  assert.equal((await holderB.receive(out.envelope, T0 + 2)).disposition, 'unique')
  let sB = await read(storeB)
  assert.deepEqual(sB.relationships.r1.links, [{ prev: g['1'].anchor, next: g['2'].anchor }])
  assert.deepEqual(sB.relationships.r1.bindings[g['1'].anchor], [AR.community.bindings['2'].commit], 'the binding computed over the link\'s next')
  assert.deepEqual(sB.relationships.r1.bindings[g['2'].anchor], [r12.body.commit])
  assert.equal(sB.contacts.c1.anchorHead, g['2'].anchor)

  // the forgery: a copy of generation 2 co-signs a successor of another seed
  const pair = await labeledContext(IKM, A.label)
  const f3 = await communityContext(IKM2, D, 3)
  const f4 = await communityContext(IKM2, D, 4)
  const { buildAnchorMapping } = await import('../dist/anchor.js')
  const fm = await buildAnchorMapping({ pair, to: B.anchor, toKeyAgreement: B.keyAgreement, self: f3, nextGen: f4, lineage: [r12, forged], revision: '2', issuedAt: '2026-10-15T09:00:05Z' })
  const held = jcs(sB.relationships)
  const r = await holderB.receive((await mappingEnvelope(A, B, fm)).envelope, T0 + 3)
  assert.deepEqual([r.disposition, r.reason, r.stage, r.ref], ['failed', 'validation-failed', 8, 'RLTP-TRU-6115'], 'condition 4b within the chain')
  assert.equal(jcs((await read(storeB)).relationships), held)

  // A rotates to generation 3 (set up by hand; the act is rotateAnchor, identity.test.mjs); the
  // owed re-issue goes out with the next revision and the lineage 1→2→3
  await edit(storeA, (s) => {
    s.register.community.head = '3'
    s.register.lineage.push(r23)
    s.duties['reissue:r1'] = { kind: 'reissue-mapping', v: 1, id: 'reissue:r1', contactId: 'c1', relId: 'r1', awaitHead: null }
  })
  const res = await holderA.resume(T0 + 4)
  const re = res.outbound.filter((o) => o.type === MAPPING)
  assert.equal(re.length, 1)
  const sA = await read(storeA)
  assert.deepEqual(sA.duties, {})
  const body3 = sA.relationships.r1.tuples[0].mappingOut.body
  assert.deepEqual([body3.revision, body3.self, body3.lineage.length], ['2', g['3'].anchor, 2])
  const r3 = await holderB.receive(re[0].envelope, T0 + 5)
  assert.equal(r3.disposition, 'unique')
  assert.deepEqual(r3.events.map((e) => e.type), ['contact.verified'])
  sB = await read(storeB)
  assert.equal(sB.relationships.r1.heldCounterpartHead, g['3'].anchor, 'a rotation (6160)')
  assert.equal(sB.contacts.c1.anchorHead, g['3'].anchor, '6560')
  assert.equal(sB.relationships.r1.links.length, 2)
  assert.equal(sB.contacts.c1.pos, '0', 'in place (2070)')
})

test('trust: a refused mapping names the rule it failed — 6115, 6117, 6118 for condition 4b, 6270 and 6170 at stage 9', async () => {
  const ID = vec('identity-derivation.json')
  const AR = vec('anchor-rotation.json')
  const D = AR.community.genesisDigest
  const IKM = Uint8Array.from(Buffer.from(ID.rootIkm, 'hex'))
  const IKM2 = new Uint8Array(crypto.hkdfSync('sha256', IKM, Buffer.alloc(0), Buffer.from('rltp/vector/second-party-root-ikm', 'utf8'), 64))
  const [r12] = AR.valid.map((v) => v.artifact)
  const A = await withCommunity(await side(0, 0x03, IKM), D, 2)
  const { B, holderB } = await trustPair({ A })
  // B holds generation 2 with the binding its card states (6610)
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, await craftMapping(A, B, { revision: '1', gen: 2, lineage: [r12] }))).envelope, T0 + 1)).disposition, 'unique')
  const f3 = await communityContext(IKM2, D, 3)
  const refOf = async (m) => (await holderB.receive((await mappingEnvelope(A, B, m)).envelope, T0 + 2)).ref
  // 6117: the card states another commit than the lineage's last element
  assert.equal(await refOf(await craftMapping(A, B, { revision: '2', gen: 2, nextGen: f3, lineage: [r12] })), 'RLTP-TRU-6117')
  // 6118: no lineage, a card for the held generation 2 under another binding
  assert.equal(await refOf(await craftMapping(A, B, { revision: '2', gen: 2, nextGen: f3 })), 'RLTP-TRU-6118')
  // 6270 and 6170 at stage 9
  assert.equal(await refOf(await craftMapping(A, B, { revision: '1', gen: 2, lineage: [r12], when: T0 + 7000 })), 'RLTP-TRU-6270')
  const other = await withCommunity(A, await digestBytes(new Uint8Array(32).fill(0x44)), 1)
  assert.equal(await refOf(await craftMapping(other, B, { revision: '3' })), 'RLTP-TRU-6170')
  // condition 2 (6080) from the condition table
  const C = await withCommunity(await side(0x0b, 0x0c), await digestBytes(new Uint8Array(32).fill(0x33)))
  assert.equal(await refOf(await craftMapping(A, C, { revision: '4', gen: 2, lineage: [r12] })), 'RLTP-TRU-6080')
})

// ── review round 1: issuance and reception through the holder ──────────

const { makeAnchorRotation, makeSelfCard, assembleAnchorMapping } = await import('../dist/anchor.js')
const { ecdh, xRawOfMk, iso } = await import('../dist/index.js')
const { InMemoryStore } = await import('../dist/testing.js')
const { createHolder } = await import('../dist/index.js')

/** The rotations g → g + 1 of a side's community for g in [from, to). */
async function rotations (s, from, to) {
  const ctx = []
  for (let g = from; g <= to + 1; g++) ctx.push(await communityContext(s.seed, s.genesis, g))
  const out = []
  for (let i = 0; i + 2 < ctx.length; i++) out.push(await makeAnchorRotation(ctx[i], ctx[i + 1], ctx[i + 2]))
  return out
}

test('trust: a lineage over 64 generations — the holder issues the 64 most recent links (6020, 6400); the addressee verifies it', async () => {
  const A0 = await withCommunity(await side(0x07, 0x03), await digestBytes(new Uint8Array(32).fill(0x31)), 67)
  const rots = await rotations(A0, 1, 67)                       // 66 links, 1 → 2 … 66 → 67
  assert.equal(rots.length, 66)
  const g1 = (await A0.gen(1)).anchor
  const { A, holderA, holderB, storeA } = await trustPair({ A: A0, a: (b) => b.lineage(rots).with((s) => { s.relationships.r1.earliestAnchor = g1 }) })
  const out = await trustAndIssue(holderA)
  const body = (await read(storeA)).relationships.r1.tuples[0].mappingOut.body
  assert.equal(body.lineage.length, 64)
  assert.equal(body.lineage[0].body.prev, (await A.gen(3)).anchor, 'the most recent 64: from generation 3')
  assert.equal(body.lineage[63].body.next, A.self)
  assert.equal((await holderB.receive(out.envelope, T0 + 2)).disposition, 'unique')
})

test('trust: two recipients, two segment starts — each lineage begins at the earliest anchor issued on its relationship (2285, 6420)', async () => {
  const A0 = await withCommunity(await side(0x07, 0x03), await digestBytes(new Uint8Array(32).fill(0x31)), 3)
  const rots = await rotations(A0, 1, 3)
  const C = await withCommunity(await side(0x0b, 0x0c), await digestBytes(new Uint8Array(32).fill(0x33)))
  const A2 = await side(0x07, 0x24)
  const { holderA, storeA } = await trustPair({
    A: A0,
    a: (b) => b.lineage(rots)
      .relationship('r2', { contactId: 'c2', tuples: [{ ownPairLabel: A2.label, counterpartAnchor: C.anchor, counterpartKeyAgreement: C.keyAgreement, rkid: A2.keyAgreement }] })
      .with((s) => { s.relationships.r1.earliestAnchor = rots[0].body.prev; s.relationships.r2.earliestAnchor = rots[1].body.prev }),
  })
  const act = (cmd, input, id) => holderA.act(cmd, input, T0, { actId: id })
  await act('trust.set', { contactId: 'c1', on: true }, 'x1')
  await act('trust.set', { contactId: 'c2', on: true }, 'x2')
  assert.equal((await holderA.resume(T0 + 1)).outbound.filter((o) => o.type === MAPPING).length, 2)
  const s = await read(storeA)
  assert.deepEqual(s.relationships.r1.tuples[0].mappingOut.body.lineage, rots, 'r1 held generation 1')
  assert.deepEqual(s.relationships.r2.tuples[0].mappingOut.body.lineage, [rots[1]], 'r2 held generation 2')
})

test('trust: deniability (6.1, the probe\'s forgeMapping) — the addressee can forge a mapping its own holder accepts; tampering with a real one fails the MACs', async () => {
  const { A, B, holderA, holderB } = await trustPair()
  const C = await withCommunity(await side(0x0b, 0x0c), await digestBytes(new Uint8Array(32).fill(0x33)))
  // B holds C's self card (C disclosed it to B) and forges: A's pair anchor ↦ C's community anchor
  const cCard = await makeSelfCard(await communityContext(C.seed, C.genesis, 1), await communityContext(C.seed, C.genesis, 2))
  const own = await labeledContext(B.seed, B.label)
  const body = { type: 'anchor-mapping@4', pair: A.anchor, self: cCard.body.anchor, to: B.anchor, card: cCard, lineage: [], revision: '1', issuedAt: iso(T0) }
  const forged = await assembleAnchorMapping(body, await ecdh(own.x.priv, xRawOfMk(A.keyAgreement)), await ecdh(own.x.priv, xRawOfMk(cCard.body.keyAgreement)))
  const r = await holderB.receive((await mappingEnvelope(A, B, forged)).envelope, T0 + 1)
  assert.equal(r.disposition, 'unique', 'the forgery verifies like a real mapping: a leaked mapping proves nothing to third parties')
  // A's real mapping, tampered: the MACs fail (condition 7)
  const real = (await openFor(B, (await trustAndIssue(holderA)).envelope)).payload
  const tampered = { ...real, body: { ...real.body, revision: '7' } }
  const t = await holderB.receive((await mappingEnvelope(A, B, tampered)).envelope, T0 + 3)
  assert.deepEqual([t.disposition, t.stage, t.ref], ['failed', 8, 'RLTP-TRU-6140'])
})

test('trust: a restart between the issuance commit and the send — resume re-offers the same sealed mapping; the addressee takes it', async () => {
  const { A, B, holderB, storeA } = await trustPair()
  const h1 = await createHolder({ store: storeA, keys: A.keys })
  await h1.act('trust.set', { contactId: 'c1', on: true }, T0, { actId: 'a1' })
  const lost = (await h1.resume(T0 + 1)).outbound.find((o) => o.type === MAPPING)   // committed, never sent
  const h2 = await createHolder({ store: storeA, keys: A.keys })    // the restart
  assert.deepEqual((await h2.resume(T0 + 2)).outbound, [], 'not due before the backoff')
  const item = (await read(storeA)).outbox[lost.digest]
  const again = (await h2.resume(item.nextAttemptAt)).outbound.filter((o) => o.type === MAPPING)
  assert.deepEqual(again.map((o) => [o.digest, o.attempt, jcs(o.envelope)]), [[lost.digest, 2, jcs(lost.envelope)]], 'byte-identical, attempt 2')
  assert.equal((await read(storeA)).relationships.r1.tuples[0].mappingOut.rev, '1', 'no second revision')
  assert.equal((await holderB.receive(again[0].envelope, item.nextAttemptAt + 1)).disposition, 'unique')
  assert.equal(B.anchor, (await openFor(B, again[0].envelope)).recipient)
})

test('trust: a CAS conflict during the mapping\'s preparation — the issuance is prepared afresh on the new state; a class turned off meanwhile issues nothing', async () => {
  const { A, storeA } = await trustPair()
  let hook = null
  const store = {
    read: () => storeA.read(),
    async commit (v, s) { if (hook) { const h = hook; hook = null; await h() } return storeA.commit(v, s) },
  }
  const h = await createHolder({ store, keys: A.keys })
  await h.act('trust.set', { contactId: 'c1', on: true }, T0, { actId: 'a1' })
  // another writer changes the profile setting between preparation and commit
  hook = () => edit(storeA, (s) => { s.contacts.c1.settings.profile = 'on' })
  const r = await h.resume(T0 + 1)
  const issued = r.outbound.filter((o) => o.type === MAPPING)
  assert.equal(issued.length, 1)
  let s = await read(storeA)
  assert.equal(s.contacts.c1.settings.profile, 'on', 'the other write survives')
  assert.equal(s.relationships.r1.tuples[0].mappingOut.rev, '1')
  assert.deepEqual(Object.keys(s.outbox).filter((d) => s.outbox[d].type === MAPPING), [issued[0].digest], 'one issuance, the re-prepared one')
  // the class turned off by the other writer: the retry finds it off and sends nothing (6410)
  await edit(storeA, (x) => { x.duties.d = { kind: 'reissue-mapping', v: 1, id: 'd', contactId: 'c1', relId: 'r1', awaitHead: null } })
  hook = () => edit(storeA, (x) => { x.contacts.c1.settings.anchorMapping = 'off' })
  const r2 = await h.resume(T0 + 2)
  assert.deepEqual(r2.outbound.filter((o) => o.type === MAPPING), [])
  s = await read(storeA)
  assert.equal(s.relationships.r1.tuples[0].mappingOut.rev, '1')
  assert.deepEqual(s.duties, {})
})

test('trust: a payload that fails the mapping schema is malformed at stage 7, with its rule (6070) on the disposition', async () => {
  const { A, B, holderB, storeB } = await trustPair()
  const m = await craftMapping(A, B)
  const seq = (await read(storeB)).commitSeq
  const r = await holderB.receive((await mappingEnvelope(A, B, { ...m, body: { ...m.body, extra: 1 } })).envelope, T0 + 1)
  assert.deepEqual([r.disposition, r.reason, r.stage, r.ref], ['failed', 'malformed', 7, 'RLTP-TRU-6070'])
  assert.equal((await read(storeB)).commitSeq, seq)
})
