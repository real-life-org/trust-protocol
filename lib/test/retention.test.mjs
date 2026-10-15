#!/usr/bin/env node
// retention in tick (lib Stage 2, PR 3; note §4.3, Delivery 4.2, §5, §7):
// key-retention = max(P90D, horizonMs) bounds effects with their acks,
// terminal outbox items (unless an unexpired journal entry names them) and
// address keys, which become tombstones that never shrink.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, jcs } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { T0, DAY, pair, read, side, stateOf, noteModule } from './pair-fixture.mjs'

const RET = 90 * DAY

test('retention: an effect leaves with its ack at expiresAt; the document is then fresh again', async () => {
  const { holderA, holderB, storeB } = await pair()
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  const r = await holderB.receive(out.envelope, T0)
  await holderB.tick(T0 + RET - 1)
  assert.ok((await read(storeB)).effects[out.digest], 'kept until expiresAt')
  await holderB.tick(T0 + RET)
  assert.deepEqual((await read(storeB)).effects, {})
  const late = await holderB.receive(out.envelope, T0 + RET)
  assert.equal(late.disposition, 'unique', 're-evaluated as fresh (4.2)')
  assert.notEqual(late.outbound[0].digest, r.outbound[0].digest, 'with a freshly generated ack')
})

test('retention: key-retention follows the longest horizon — max(P90D, horizonMs)', async () => {
  const { holderA, holderB, storeB } = await pair({ retry: { horizonMs: 90 * DAY } })
  const out = (await holderA.act('note.send', {}, T0)).outbound[0]
  await holderB.receive(out.envelope, T0)
  assert.equal((await read(storeB)).effects[out.digest].expiresAt, T0 + RET)
})

test('retention: terminal outbox items go the retention after their last step; open ones stay', async () => {
  const { holderA, storeA } = await pair()
  const a = (await holderA.act('note.send', {}, T0)).outbound[0].digest          // delivered at T0 + 10
  const b = (await holderA.act('note.send', {}, T0)).outbound[0].digest          // failed at T0 + 20
  const c = (await holderA.act('note.send', {}, T0)).outbound[0].digest          // stays open
  await holderA.report({ digest: a, status: 'delivered', late: false }, T0 + 10)
  await holderA.report({ digest: b, status: 'failed', reason: 'unroutable' }, T0 + 20)
  await holderA.tick(T0 + 10 + RET - 1)
  assert.deepEqual(Object.keys((await read(storeA)).outbox).sort(), [a, b, c].sort())
  await holderA.tick(T0 + 10 + RET)
  assert.deepEqual(Object.keys((await read(storeA)).outbox).sort(), [b, c].sort())
  await holderA.tick(T0 + 20 + RET)
  assert.deepEqual(Object.keys((await read(storeA)).outbox), [c], 'an open item is the horizon\'s (resume), never retention\'s')
})

test('retention: a journaled terminal item stays exactly as long as its act record', async () => {
  const human = {
    name: 'h',
    commands: {
      'h.send': {
        human: true,
        apply: (state, _p, input) => ({
          state,
          outbound: [{ digest: input.d, envelope: { rkid: state.relationships.r1.tuples[0].counterpartKeyAgreement, epk: 'e', nonce: 'n', ciphertext: input.d }, type: 'https://real-life.org/trust-tasks/profile/0.1', threadId: 't', recipient: { contactId: 'c1', rkid: state.relationships.r1.tuples[0].rkid, keyAgreement: state.relationships.r1.tuples[0].counterpartKeyAgreement } }],
        }),
      },
    },
  }
  const { holderA, storeA } = await pair({ modules: () => [noteModule(), human] })
  await holderA.act('h.send', { d: 'uJ' }, T0 + 100, { actId: 'k1' })
  await holderA.report({ digest: 'uJ', status: 'delivered', late: false }, T0)
  // the item's terminal step is past the retention, the act record is not
  await holderA.tick(T0 + 100 + RET - 1)
  let s = await read(storeA)
  assert.ok(s.outbox.uJ && s.acts.k1, 'kept while the journal names it')
  const replay = await holderA.act('h.send', { d: 'uJ' }, T0 + 100 + RET - 1, { actId: 'k1' })
  assert.deepEqual(replay, { ok: true, outbound: [], events: [] }, 'replay still finds its item')
  await holderA.tick(T0 + 100 + RET)
  s = await read(storeA)
  assert.equal(Object.hasOwn(s.outbox, 'uJ'), false)
  assert.equal(Object.hasOwn(s.acts, 'k1'), false)
})

test('retention: an address key not shown for the retention becomes a tombstone unless a live tuple holds it; tombstones never shrink', async () => {
  const A = await side(0x07, 0x03)
  const B = await side(0x09, 0x05)
  const s0 = stateOf(A, B)
  s0.addresses.keys.z6LSshownOnACardOnly = { label: 'persona/card', lastShown: T0 }
  s0.addresses.keys.z6LSshownLater = { label: 'persona/later', lastShown: T0 + DAY }
  s0.addresses.tombstones = ['z6LSoldTombstone']
  const store = new InMemoryStore()
  await store.commit(null, s0)
  const h = await createHolder({ store, keys: A.keys }, { modules: [noteModule()] })
  await h.tick(T0 + RET - 1)
  assert.equal(jcs((await read(store)).addresses), jcs(s0.addresses), 'nothing before the retention')
  await h.tick(T0 + RET)
  let s = await read(store)
  assert.deepEqual(Object.keys(s.addresses.keys).sort(), [A.keyAgreement, 'z6LSshownLater'].sort(), 'the live tuple keeps its rkid')
  assert.deepEqual(s.addresses.tombstones, ['z6LSoldTombstone', 'z6LSshownOnACardOnly'])
  // a deactivated tuple no longer holds its key
  const s1 = structuredClone(s)
  s1.relationships.r1.tuples[0].deactivated = true
  const store2 = new InMemoryStore()
  await store2.commit(null, s1)
  const h2 = await createHolder({ store: store2, keys: A.keys }, { modules: [noteModule()] })
  await h2.tick(T0 + RET + DAY)
  s = await read(store2)
  assert.deepEqual(s.addresses.keys, {})
  assert.deepEqual(s.addresses.tombstones.slice(0, 2), ['z6LSoldTombstone', 'z6LSshownOnACardOnly'], 'appended, never removed')
  assert.deepEqual([...s.addresses.tombstones].sort(), ['z6LSoldTombstone', 'z6LSshownOnACardOnly', A.keyAgreement, 'z6LSshownLater'].sort())
  // a tick with nothing to retain commits nothing
  const seq = s.commitSeq
  await h2.tick(T0 + RET + DAY)
  assert.equal((await read(store2)).commitSeq, seq)
})

test('timer: a shown code with nothing else open — resume names the challenge\'s aging deadline; tick at it removes the aged value (5.3), and the address key\'s retention is named after that', async () => {
  const { createHolder, seedKeys } = await import('../dist/index.js')
  const { InMemoryStore } = await import('../dist/testing.js')
  const T = Date.parse('2026-10-16T09:00:00Z')
  const h = await createHolder({ store: new InMemoryStore(), keys: seedKeys(new Uint8Array(64).fill(0x61)) })
  const shown = await h.show({ when: T, actId: 's1' })
  assert.ok(shown.nextDueAt !== undefined && shown.nextDueAt > T, 'the show names the aging deadline it introduced')
  const r = await h.resume(T)
  assert.equal(r.nextDueAt, shown.nextDueAt)
  await h.tick(r.nextDueAt)
  const s = (await h.snapshot()).state
  assert.deepEqual(s.encounter.challenges, {}, 'aged and removed')
  const r2 = await h.resume(r.nextDueAt)
  assert.ok(r2.nextDueAt > r.nextDueAt, 'the key retention comes next')
  await h.tick(r2.nextDueAt)
  assert.equal((await h.snapshot()).state.addresses.tombstones.length, 1, 'the displayed key retained into a tombstone by the timer alone')
})
