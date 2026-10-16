#!/usr/bin/env node
// trust-admission (lib Stage 2, PR 4a; Trust Section 2): the deliverable
// set on the holder — one entry per relationship, committed by the first
// verified mapping in one total order (2060, 2120, 2190), updated in place
// (2070), pending at the bound (2250), re-committed after state loss
// (2240); stateBuilder, the states these tests stand on.
//
// Admission when a merge or a departure frees a slot (2150, 2250) and the
// removal of a pending entry with its relationship (2260):
// trust-entries.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestBytes, jcs, StateCodecError } from '../dist/index.js'
import { InMemoryStore, stateBuilder } from '../dist/testing.js'
import { createEngine, trustModule, contactView, decodeState, ADMISSION_BOUND } from '../dist/internal.js'
import { T0, trustPair, side, withCommunity, builderOf, mappingEnvelope, craftMapping, edit, read } from './pair-fixture.mjs'

const C0 = async () => withCommunity(await side(0x0b, 0x0c), await digestBytes(new Uint8Array(32).fill(0x33)))

test('stateBuilder: builds a valid state the codec accepts; an invalid one throws at build', async () => {
  const s = stateBuilder({ at: T0 })
    .community('uEiDYLnFbXqm2cwuJWuk9yNzRmlzWDpCTH6yA_4aP_1z_RA', '2')
    .relationship('r1', { contactId: 'c1', tuples: [{ ownPairLabel: 'pair/x', counterpartAnchor: 'did:key:a', counterpartKeyAgreement: 'zKa', rkid: 'zRk' }] })
    .entry('c1')
    .settings('c1', { anchorMapping: 'on' })
    .duty({ kind: 'class-on', v: 1, id: 'd1', contactId: 'c1', relId: 'r1', cls: 'anchorMapping' })
    .build()
  assert.equal(jcs(decodeState(s)), jcs(s))
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.contacts.c1.relIds, s.entryOrder], ['0', 'admitted', ['r1'], { nextPos: '1', heads: ['r1'] }])
  assert.deepEqual(s.addresses.keys.zRk, { label: 'pair/x', lastShown: T0 })
  assert.equal(s.relationships.r1.tuples[0].entryId, 'c1')
  assert.equal(s.register.community.head, '2')
  const b = stateBuilder()
  const one = b.build()
  one.contacts.x = 1
  assert.deepEqual(b.build().contacts, {}, 'build hands out an independent copy')
  assert.throws(() => stateBuilder().with((x) => { x.lastWhen = -1 }).build(), StateCodecError)
})

test('admission: entries commit in the order of their verifications, one per relationship (2060, 2120, 2190)', async () => {
  const C = await C0()
  const B2 = await side(0x09, 0x0d)   // B's own key on a second pair label, toward C
  const { A, B, storeB, holderB } = await trustPair({
    b: (x) => x.relationship('r2', { contactId: 'c2', tuples: [{ ownPairLabel: B2.label, counterpartAnchor: C.anchor, counterpartKeyAgreement: C.keyAgreement, rkid: B2.keyAgreement }] }),
  })
  const fromC = await mappingEnvelope(C, B2, await craftMapping(C, B2))
  assert.equal((await holderB.receive(fromC.envelope, T0 + 1)).disposition, 'unique')
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, await craftMapping(A, B))).envelope, T0 + 2)).disposition, 'unique')
  const s = await read(storeB)
  assert.deepEqual([s.contacts.c2.pos, s.contacts.c1.pos, s.entryOrder.nextPos], ['0', '1', '2'])
  assert.deepEqual((await holderB.contacts()).map((c) => c.id), ['c2', 'c1'], 'the views list in entry-commit order')
})

test('admission: a first verified mapping at a full set yields a deliverable-pending entry (2250)', async () => {
  const { A, B } = await trustPair()
  const C = await C0()
  const store = new InMemoryStore()
  // B already admits one member (c0); the bound is 1 for this test
  const B0 = await side(0x09, 0x0e)
  await store.commit(null, builderOf(B, A, { entry: false }).community(B.genesis)
    .relationship('r0', { contactId: 'c0', tuples: [{ ownPairLabel: B0.label, counterpartAnchor: C.anchor, counterpartKeyAgreement: C.keyAgreement, rkid: B0.keyAgreement }] })
    .entry('c0').build())
  const e = await createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: 1n })])
  const r = await e.receive((await mappingEnvelope(A, B, await craftMapping(A, B))).envelope, T0 + 1)
  assert.equal(r.disposition, 'unique')
  const s = (await e.snapshot()).state
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status], ['1', 'pending'])
  assert.deepEqual([s.contacts.c0.pos, s.contacts.c0.status], ['0', 'admitted'])
  assert.equal(contactView(s, 'c1').verification, 'incoming')
  // the bound is a constant of the wire domain; a factory beyond it is refused
  assert.equal(ADMISSION_BOUND, 10n ** 18n - 1n)
  assert.throws(() => trustModule({ admissionBound: ADMISSION_BOUND + 1n }), RangeError)
})

test('admission: state loss (2240) — a recovered mapping re-commits its entry at once; a recovered entry keeps its position; with neither, the redelivery appends', async () => {
  const { A, B, holderB, storeB } = await trustPair()
  const m1 = await craftMapping(A, B, { revision: '1' })
  const env1 = await mappingEnvelope(A, B, m1)
  assert.equal((await holderB.receive(env1.envelope, T0 + 1)).disposition, 'unique')
  // lost: the entry, not the mapping
  await edit(storeB, (s) => { s.contacts.c1.pos = null; s.contacts.c1.status = 'none'; s.entryOrder.nextPos = '4' })
  assert.equal((await holderB.contact('c1')).id, 'c1')
  const rec = await holderB.act('trust.recover', {}, T0 + 2)
  assert.equal(rec.ok, true)
  let s = await read(storeB)
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status, s.entryOrder.nextPos], ['4', 'admitted', '5'])
  // nothing to recover: nothing commits
  const seq = s.commitSeq
  await holderB.act('trust.recover', {}, T0 + 2)
  assert.equal((await read(storeB)).commitSeq, seq)
  // a later verification keeps the recovered position (2070), and so does a repeat
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, m1)).envelope, T0 + 3)).disposition, 'unique')
  assert.equal((await holderB.receive((await mappingEnvelope(A, B, await craftMapping(A, B, { revision: '2' }))).envelope, T0 + 4)).disposition, 'unique')
  s = await read(storeB)
  assert.deepEqual([s.contacts.c1.pos, s.entryOrder.nextPos], ['4', '5'])

  // the repeat path re-commits as well: the entry lost, the identical body resent
  await edit(storeB, (x) => { x.contacts.c1.pos = null; x.contacts.c1.status = 'none' })
  const m2 = s.relationships.r1.tuples[0].mappingIn.body
  const again = await craftMapping(A, B, { revision: '2' })
  assert.equal(jcs(again.body), jcs(m2))
  const rep = await holderB.receive((await mappingEnvelope(A, B, again)).envelope, T0 + 5)
  assert.deepEqual([rep.disposition, rep.events], ['unique', []])
  s = await read(storeB)
  assert.deepEqual([s.contacts.c1.pos, s.entryOrder.nextPos], ['5', '6'])

  // neither survived: a fresh store, the redelivered document commits and appends
  const fresh = new InMemoryStore()
  await fresh.commit(null, builderOf(B, A, { entry: false }).community(B.genesis).with((x) => { x.entryOrder.nextPos = '7' }).build())
  const e = await createEngine({ store: fresh, keys: B.keys }, [trustModule()])
  assert.equal((await e.receive(env1.envelope, T0 + 6)).disposition, 'unique')
  const f = (await e.snapshot()).state
  assert.deepEqual([f.contacts.c1.pos, f.contacts.c1.status], ['7', 'admitted'])
})

test('admission: a mapping arriving on a deactivated tuple is refused (6240); nothing commits', async () => {
  const { A, B, holderB, storeB } = await trustPair({ b: (x) => x.with((s) => { s.relationships.r1.tuples[0].deactivated = true }) })
  const seq = (await read(storeB)).commitSeq
  const r = await holderB.receive((await mappingEnvelope(A, B, await craftMapping(A, B))).envelope, T0 + 1)
  assert.deepEqual([r.disposition, r.reason, r.stage], ['failed', 'validation-failed', 8])
  assert.equal((await read(storeB)).commitSeq, seq)
})

test('admission: trust.recover admits pending entries in position order while the set has room (2250; the departure that frees a slot is PR 4c)', async () => {
  const { B } = await trustPair()
  const mk = async (bound) => {
    const store = new InMemoryStore()
    const b = stateBuilder({ at: T0 })
    for (const [i, id] of ['c2', 'c0', 'c1'].entries()) {
      const s = await side(0x09, 0x40 + i)
      b.relationship('r-' + id, { contactId: id, tuples: [{ ownPairLabel: s.label, counterpartAnchor: 'did:key:z' + id, counterpartKeyAgreement: 'zKa' + id, rkid: s.keyAgreement }] })
    }
    // positions 0, 1, 2 in the order c0, c1, c2; all pending, as after a full set
    b.entry('c0', { status: 'pending' }).entry('c1', { status: 'pending' }).entry('c2', { status: 'pending' })
    await store.commit(null, b.build())
    return createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: bound })])
  }
  const status = async (e) => Object.fromEntries(Object.values((await e.snapshot()).state.contacts).map((c) => [c.id, [c.pos, c.status]]))
  const e2 = await mk(2n)
  assert.equal((await e2.act('trust.recover', {}, T0 + 1)).ok, true)
  assert.deepEqual(await status(e2), { c0: ['0', 'admitted'], c1: ['1', 'admitted'], c2: ['2', 'pending'] })
  const e0 = await mk(0n)
  await e0.act('trust.recover', {}, T0 + 1)
  assert.deepEqual(await status(e0), { c0: ['0', 'pending'], c1: ['1', 'pending'], c2: ['2', 'pending'] }, 'a full set admits none')
})

test('admission: trust.recover, mixed — a pending entry takes the one free slot in position order; a recovered entry keeps its position; a lost one re-commits after them', async () => {
  const { A, B } = await trustPair()
  // B verified A's mapping on r1 (c1), then lost c1's entry; c0 survived at
  // position 0, admitted; c2 waits pending at position 1; the bound is 2
  const store = new InMemoryStore()
  const b = builderOf(B, A, { entry: false }).community(B.genesis)
  for (const [i, id] of ['c0', 'c2'].entries()) {
    const s = await side(0x09, 0x50 + i)
    b.relationship('r-' + id, { contactId: id, tuples: [{ ownPairLabel: s.label, counterpartAnchor: 'did:key:z' + id, counterpartKeyAgreement: 'zKa' + id, rkid: s.keyAgreement }] })
  }
  b.entry('c0').entry('c2', { status: 'pending' })
  await store.commit(null, b.build())
  const e0 = await createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: 2n })])
  assert.equal((await e0.receive((await mappingEnvelope(A, B, await craftMapping(A, B))).envelope, T0 + 1)).disposition, 'unique')
  let s = (await e0.snapshot()).state
  assert.deepEqual([s.contacts.c1.pos, s.contacts.c1.status], ['2', 'admitted'], 'committed while c2 waits: 1 admitted < 2')
  await edit(store, (x) => { x.contacts.c1.pos = null; x.contacts.c1.status = 'none' })   // the entry lost, the mapping held
  const e = await createEngine({ store, keys: B.keys }, [trustModule({ admissionBound: 2n })])
  assert.equal((await e.act('trust.recover', {}, T0 + 2)).ok, true)
  s = (await e.snapshot()).state
  const at = (id) => [s.contacts[id].pos, s.contacts[id].status]
  assert.deepEqual([at('c0'), at('c2'), at('c1')], [['0', 'admitted'], ['1', 'admitted'], ['3', 'pending']])
  assert.equal(s.entryOrder.nextPos, '4')
})
