#!/usr/bin/env node
// trust-group-star (lib Stage 2, PR 4b; Trust 5.2b, 5.4 group star,
// 6595): group-star@1 on the holder — the view per (group, contact),
// filler or sealed pair, the all-filler star, its own scope beside the
// star, lagging relationships, and the reception: only the holder's own
// groups open, the member merged holder-locally (class V), sharedGroups.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestBytes, b64uOf, jcs } from '../dist/index.js'
import { createHolder } from '../dist/index.js'
import { T0 } from './pair-fixture.mjs'
import { STAR, GSTAR, ACK, person, network, pairSide, tupleSpec, state, tupleOf, edit, openAt, groupStarDoc } from './star-fixture.mjs'

const ofType = (out, type) => out.filter((o) => o.type === type)
const oid = (n) => 'oid:' + b64uOf(new Uint8Array(32).fill(n))
const groupId = (n) => digestBytes(new Uint8Array(32).fill(n))

/** A group of person p: its id, p's member label and anchor, the oid of p's admission. */
async function membership (p, n) {
  const id = await groupId(n)
  const memberLabel = 'group/' + id
  const m = await p.keys.anchorOf(memberLabel)
  return { id, memberLabel, memberAnchor: m.anchor, memberKa: m.keyAgreement, memberOp: oid(n) }
}
const groupState = (g, extra = {}) => ({ id: g.id, memberLabel: g.memberLabel, rules: { vouchThreshold: '1' }, listed: true, membership: null, memberAnchor: g.memberAnchor, memberOp: g.memberOp, ...extra })

/** The Access port of a recipient: it knows the groups `known`, each with
 *  the sender's admission (member, its card key) materialized. */
const accessOf = (known) => ({
  memberships: async () => known.map((k) => k.access),
  membership: async (g) => known.find((k) => k.id === g)?.access ?? null,
})
const accessEntry = (g, admission) => ({
  id: g.id,
  access: {
    group: g.id,
    isMember: (a) => a === admission.memberAnchor,
    resolve: (o) => (o === admission.memberOp ? { subject: admission.memberAnchor, keyAgreement: admission.memberKa } : null),
  },
})

test('group star: filler or a sealed pair per (group, contact) — trusted contacts get the pair by default, a per-group on seals toward anyone (5430, 2830); its own scope beside the star (5730)', async () => {
  const A = await person('A', 0x91), B = await person('B', 0x92), C = await person('C', 0x93)
  const G1 = await membership(A, 0x01), G2 = await membership(A, 0x02)
  await network([A, B, C], [[A, B], [A, C]], {
    build: {
      A: (b) => b.settings('B', { anchorMapping: 'on' }).with((s) => {
        s.groups[G1.id] = groupState(G1); s.groups[G2.id] = groupState(G2)
        s.contacts.C.groupSettings[G2.id] = 'on'
      }),
    },
  })
  const r = await A.holder.resume(T0)
  assert.equal(ofType(r.outbound, STAR).length, 2)
  assert.equal(ofType(r.outbound, GSTAR).length, 2)
  const s = await state(A)
  const sorted = [G1, G2].sort((x, y) => (x.id < y.id ? -1 : 1))
  const sealed = (g) => ({ group: g.id, mode: 'sealed', member: g.memberAnchor, memberOp: g.memberOp })
  assert.deepEqual(tupleOf(s, 'r-B').groupStarOut.inflight['1'].view, sorted.map(sealed))
  assert.deepEqual(tupleOf(s, 'r-C').groupStarOut.inflight['1'].view, sorted.map((g) => (g === G2 ? sealed(g) : { group: g.id, mode: 'digest' })))
  assert.equal(tupleOf(s, 'r-B').starOut.lastSalt, '1', 'the star has its own salt sequence')
  // the wire: 16 entries (padded), every c the same length, one thread per salt
  const doc = await openAt(B, A, ofType(r.outbound, GSTAR).find((o) => o.recipient.contactId === 'B').envelope)
  assert.equal(doc.payload.body.groups.length, 16)
  assert.equal(new Set(doc.payload.body.groups.map((e) => e.c.length)).size, 1)
  // switching the sealed class off toward B resets nothing per group here and turns both to filler: divergence, a new salt
  await A.holder.act('trust.setClass', { contactId: 'B', cls: 'sealedGroupStar', setting: 'off' }, T0 + 1, { actId: 'off' })
  await A.holder.report({ digest: ofType(r.outbound, GSTAR).find((o) => o.recipient.contactId === 'B').digest, status: 'failed', reason: 'unroutable' }, T0 + 1)
  const r2 = await A.holder.resume(T0 + 2)
  assert.deepEqual(ofType(r2.outbound, GSTAR).map((o) => o.recipient.contactId), ['B'])
  assert.deepEqual(ofType(r2.outbound, STAR), [], 'the star does not move with the group star')
  assert.deepEqual(tupleOf(await state(A), 'r-B').groupStarOut.inflight['2'].view, sorted.map((g) => ({ group: g.id, mode: 'digest' })))
  // the blinded group star off toward C: no group star to C at all (5760), the star unaffected
  await A.holder.act('trust.setClass', { contactId: 'C', cls: 'groupStar', setting: 'off' }, T0 + 3, { actId: 'gs-off' })
  await edit(A, (x) => { x.groups[G1.id].listed = false })
  const r3 = await A.holder.resume(T0 + 4)
  assert.deepEqual(ofType(r3.outbound, GSTAR).map((o) => o.recipient.contactId), ['B'], 'unlisting G1 diverges toward B only')
})

test('group star: a sender with no group sends one all-filler group star (5480); the recipient accepts it, sharing no group', async () => {
  const A = await person('A', 0xa1), B = await person('B', 0xa2)
  const net = await network([A, B], [[A, B]])
  assert.equal((await B.holder.contact('A')).sharedGroups, undefined, 'nothing accepted yet: undefined, never a claimed empty list')
  const r = await A.holder.resume(T0)
  const gs = ofType(r.outbound, GSTAR)
  assert.equal(gs.length, 1)
  const body = (await openAt(B, A, gs[0].envelope)).payload.body
  assert.deepEqual([body.salt, body.seq, body.last, body.groups.length], ['1', '1', true, 16])
  const log = await net.deliver(gs, T0 + 1)
  assert.deepEqual(log[0].r.events.map((e) => [e.type, e.contactId, e.salt]), [['groupStar.accepted', 'A', '1']])
  assert.deepEqual((await B.holder.contact('A')).sharedGroups, [])
  assert.deepEqual(tupleOf(await state(A), 'r-B').groupStarOut.snapshot, [], 'completed: the empty view is the baseline')
  assert.deepEqual(ofType((await A.holder.resume(T0 + 2)).outbound, GSTAR), [], 'converged')
})

test('group star reception: only the holder\'s own groups open; an accepted pair merges the member into the relationship\'s memory and goes nowhere else (5520–5580); sharedGroups', async () => {
  const A = await person('A', 0xb1), B = await person('B', 0xb2)
  const G1 = await membership(A, 0x11), G2 = await membership(A, 0x12)
  const B1 = await membership(B, 0x11)               // B is in G1, not in G2
  const net = await network([A, B], [[A, B]], {
    build: {
      A: (b) => b.settings('B', { anchorMapping: 'on' }).with((s) => { s.groups[G1.id] = groupState(G1); s.groups[G2.id] = groupState(G2) }),
      B: (b) => b.with((s) => { s.groups[B1.id] = groupState(B1) }),
    },
    holder: { B: (p) => createHolder({ store: p.store, keys: p.keys, access: accessOf([accessEntry(B1, G1)]) }) },
  })
  const gs = ofType((await A.holder.resume(T0)).outbound, GSTAR)
  const log = await net.deliver(gs, T0 + 1)
  const r = log[0].r
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.outbound.map((o) => o.type), [ACK], 'nothing republished, nothing into any group space (5580)')
  assert.deepEqual(r.events.map((e) => e.type), ['groupStar.accepted'])
  const sB = await state(B)
  const acc = tupleOf(sB, 'r-A').groupStarIn.accepted
  assert.deepEqual(acc.groups, [G1.id])
  assert.equal(acc.entries.length, 1, 'only the hit entry is kept')
  assert.deepEqual(sB.relationships['r-A'].memory.groupMembers, { [G1.id]: { member: G1.memberAnchor, memberOp: G1.memberOp } })
  assert.equal(jcs(sB.groups), jcs({ [B1.id]: groupState(B1) }), 'the group state is untouched')
  assert.deepEqual(Object.keys(sB.outbox), [], 'B issued nothing')
  assert.deepEqual((await B.holder.contact('A')).sharedGroups, [G1.id])
  // without an Access view the hit counts, the pair is not accepted
  const C = await person('C', 0xb3)
  const A2 = await person('A', 0xb1)                 // A again, in a network of its own
  const net2 = await network([A2, C], [[A2, C]], {
    build: {
      A: (b) => b.settings('C', { anchorMapping: 'on' }).with((s) => { s.groups[G1.id] = groupState(G1) }),
      C: (b) => b.with((s) => { s.groups[G1.id] = groupState(G1, { memberLabel: 'group/' + G1.id }) }),
    },
  })
  const gsC = ofType((await A2.holder.resume(T0)).outbound, GSTAR)
  await net2.deliver(gsC, T0 + 1)
  const sC = await state(C)
  assert.deepEqual(tupleOf(sC, 'r-A').groupStarIn.accepted.groups, [G1.id])
  assert.equal(sC.relationships['r-A'].memory.groupMembers, undefined)
})

test('group star reception: an assembly off the multiple of 16 or with uneven c lengths is refused (5500, 5510)', async () => {
  const A = await person('A', 0xc1), B = await person('B', 0xc2)
  await network([A, B], [[A, B]])
  const d = (i) => 'u' + b64uOf(new Uint8Array(32).fill(i))
  const c = (n) => 'u' + b64uOf(new Uint8Array(n).fill(7))
  const entries = (k, len = () => 380) => Array.from({ length: k }, (_, i) => ({ d: d(i + 1), c: c(len(i)) })).sort((x, y) => (x.d < y.d ? -1 : 1))
  const r1 = await B.holder.receive((await groupStarDoc(A, B, { salt: '1', groups: entries(15) })).envelope, T0)
  assert.deepEqual([r1.disposition, r1.ref], ['failed', 'RLTP-TRU-5500'])
  const r2 = await B.holder.receive((await groupStarDoc(A, B, { salt: '2', groups: entries(16, (i) => (i === 3 ? 383 : 380)) })).envelope, T0)
  assert.deepEqual([r2.disposition, r2.ref], ['failed', 'RLTP-TRU-5510'])
  assert.equal(tupleOf(await state(B), 'r-A').groupStarIn.lowerBound, '0', 'a rejection commits nothing')
  const r3 = await B.holder.receive((await groupStarDoc(A, B, { salt: '3', groups: entries(16) })).envelope, T0)
  assert.equal(r3.disposition, 'unique')
})

test('group star: a lagging relationship still gets the star and the blinded group star, its c filler only (6595); the other strand gets the sealed pair', async () => {
  const A = await person('A', 0xd1), B = await person('B', 0xd2)
  const G1 = await membership(A, 0x21)
  const X1 = 'did:key:z6MkhPjg5MgkyGp2WTuWe8cA1nWczN1strK8AcUSVCZpPEnN'
  const X2 = 'did:key:z6MknXvHPd2AimwxPVcptemsQL1eNeizHcujQR4Q3bNkVda7'
  await network([A, B], [[A, B]], {
    build: {
      A: (b) => b.settings('B', { anchorMapping: 'on' }).with((s) => { s.groups[G1.id] = groupState(G1) }),
    },
  })
  // a second strand toward B that lags: r-B holds X2 with the link X1 → X2, r2 still presents X1
  const a2 = await pairSide(A), b2 = await pairSide(B)
  A.pairs.B2 = a2; B.pairs.A2 = b2
  await edit(A, (s) => {
    const t = structuredClone(s.relationships['r-B'].tuples[0])
    s.relationships.r2 = { ...structuredClone(s.relationships['r-B']), id: 'r2', tuples: [{ ...t, ...tupleSpec(a2, b2), entryId: 'B' }], activeHead: a2.label, heldCounterpartHead: X1 }
    Object.assign(s.relationships['r-B'], { heldCounterpartHead: X2, links: [{ prev: X1, next: X2 }] })
    s.contacts.B.relIds.push('r2')
    s.register.labels.push(a2.label)
    s.addresses.keys[a2.keyAgreement] = { label: a2.label, lastShown: T0 }
    s.entryOrder.heads.push('r2')
  })
  const r = await A.holder.resume(T0)
  assert.deepEqual(ofType(r.outbound, STAR).map((o) => o.recipient.rkid).sort(), [A.pairs.B.keyAgreement, a2.keyAgreement].sort(), 'the star on both strands')
  assert.deepEqual(ofType(r.outbound, GSTAR).map((o) => o.recipient.rkid).sort(), [A.pairs.B.keyAgreement, a2.keyAgreement].sort(), 'the blinded group star on both')
  const s = await state(A)
  assert.deepEqual(s.relationships.r2.tuples[0].groupStarOut.inflight['1'].view, [{ group: G1.id, mode: 'digest' }], 'lagging: nothing sealed')
  assert.deepEqual(tupleOf(s, 'r-B').groupStarOut.inflight['1'].view, [{ group: G1.id, mode: 'sealed', member: G1.memberAnchor, memberOp: G1.memberOp }])
})
