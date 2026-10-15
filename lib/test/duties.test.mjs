#!/usr/bin/env node
// duties (lib Stage 2, PR 3; note §2.1 duties, §4.3 resume): resume runs
// due duties through the handlers registered by kind and version, in a
// fixed order, after the outbox; unknown versions stay and are announced;
// awaitHead waits on the module's pure condition; dueAt feeds nextDueAt.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, jcs } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { T0, side, stateOf, read } from './pair-fixture.mjs'

const KIND = 'test-duty'

/** A module that adds duties and a handler for KIND at version 1. */
const dutyModule = (log = []) => ({
  name: 'dut',
  commands: {
    'duty.add': { human: false, apply: (state, _p, input) => ({ state, duties: input.duties }) },
    'head.set': {
      human: false,
      apply: (state, _p, input) => ({ state: { ...state, relationships: { ...state.relationships, r1: { ...state.relationships.r1, heldCounterpartHead: input.head } } } }),
    },
  },
  duties: {
    [KIND]: {
      v: 1,
      async prepare (ctx, duty) { return { seen: duty.id, at: ctx.when } },
      awaitHolds: (state, duty) => state.relationships.r1.heldCounterpartHead === duty.awaitHead,
      apply (state, duty, ctx, when) {
        log.push([duty.id, ctx.prepared.value, when])
        if (duty.mode === 'not-due') return 'not-due'
        if (duty.mode === 'refuse') return { ok: false, code: 'in-flight' }
        const out = duty.mode === 'send'
          ? [{ digest: 'uDuty' + duty.id, envelope: { rkid: state.relationships.r1.tuples[0].counterpartKeyAgreement, epk: 'e', nonce: 'n', ciphertext: duty.id }, type: 'https://real-life.org/trust-tasks/profile/0.1', threadId: 't-' + duty.id, recipient: { contactId: 'c1', rkid: state.relationships.r1.tuples[0].rkid, keyAgreement: state.relationships.r1.tuples[0].counterpartKeyAgreement } }]
          : []
        return {
          state: { ...state, encounter: { ...state.encounter, records: { ...state.encounter.records, [duty.id]: { done: when } } } },
          outbound: out,
          events: [{ type: 'profile.updated', contactId: null }],
        }
      },
    },
  },
})

const holder = async (log) => {
  const A = await side(0x07, 0x03)
  const B = await side(0x09, 0x05)
  const store = new InMemoryStore()
  await store.commit(null, stateOf(A, B))
  return { store, h: await createHolder({ store, keys: A.keys }, { modules: [dutyModule(log)] }) }
}
const duty = (id, extra = {}) => ({ kind: KIND, v: 1, id, ...extra })

test('duties: resume runs due duties in order (dueAt, id), prepared against its snapshot, and removes the fulfilled ones', async () => {
  const log = []
  const { store, h } = await holder(log)
  await h.act('duty.add', { duties: [duty('b'), duty('a', { mode: 'send' }), duty('c', { dueAt: T0 - 5 }), duty('d', { dueAt: T0 - 10 })] }, T0)
  const r = await h.resume(T0 + 1)
  assert.deepEqual(log.map(([id]) => id), ['a', 'b', 'd', 'c'], 'by dueAt (absent: always due, first), then id')
  assert.deepEqual(log[0], ['a', { seen: 'a', at: T0 + 1 }, T0 + 1])
  assert.deepEqual(r.outbound.map((o) => [o.digest, o.attempt]), [['uDutya', 1]], 'a duty\'s document enters the outbox at attempt 1')
  assert.deepEqual(r.events.map((e) => e.type), ['profile.updated', 'profile.updated', 'profile.updated', 'profile.updated'])
  const s = await read(store)
  assert.deepEqual(s.duties, {})
  assert.deepEqual(Object.keys(s.encounter.records).sort(), ['a', 'b', 'c', 'd'])
  assert.equal(s.outbox.uDutya.history[0].status, 'submitted')
  assert.equal(r.nextDueAt, s.outbox.uDutya.nextAttemptAt, 'the new item is due next')
})

test('duties: not-due and a refusal leave the duty; dueAt in the future waits and sets nextDueAt', async () => {
  const log = []
  const { store, h } = await holder(log)
  await h.act('duty.add', { duties: [duty('n', { mode: 'not-due' }), duty('r', { mode: 'refuse' }), duty('later', { dueAt: T0 + 5000 })] }, T0)
  const seq = (await read(store)).commitSeq
  const r = await h.resume(T0 + 1)
  assert.deepEqual(log.map(([id]) => id), ['n', 'r'])
  assert.deepEqual(r, { outbound: [], events: [], nextDueAt: T0 + 5000 })
  const s = await read(store)
  assert.deepEqual(Object.keys(s.duties).sort(), ['later', 'n', 'r'])
  assert.equal(s.commitSeq, String(BigInt(seq) + 1n), 'only the raised lastWhen commits')
  await h.resume(T0 + 1)
  assert.equal((await read(store)).commitSeq, s.commitSeq, 'a resume with nothing done commits nothing')
  await h.resume(T0 + 5000)
  assert.equal(Object.hasOwn((await read(store)).duties, 'later'), false, 'run once due')
})

test('duties: a registered kind at an unknown version stays untouched and is announced once per resume; an unregistered kind stays silent', async () => {
  const log = []
  const { store, h } = await holder(log)
  await h.act('duty.add', { duties: [duty('v2', { v: 2 }), { kind: 'other-kind', v: 1, id: 'o' }] }, T0)
  const r1 = await h.resume(T0 + 1)
  assert.deepEqual(r1.events.map((e) => [e.type, e.dutyId, e.kind, e.v]), [['duty.unsupported', 'v2', KIND, 2]])
  const r2 = await h.resume(T0 + 2)
  assert.equal(r2.events.length, 1, 'again on the next resume, once')
  assert.notEqual(r1.events[0].eventId, r2.events[0].eventId)
  assert.deepEqual(log, [])
  const s = await read(store)
  assert.deepEqual(s.duties.v2, duty('v2', { v: 2 }))
  assert.deepEqual(s.duties.o, { kind: 'other-kind', v: 1, id: 'o' })
})

test('duties: a duty awaiting a head runs only once the module\'s condition holds', async () => {
  const log = []
  const { store, h } = await holder(log)
  await h.act('duty.add', { duties: [duty('w', { awaitHead: 'did:key:z6MkHead' })] }, T0)
  await h.resume(T0 + 1)
  await h.act('head.set', { head: 'did:key:z6MkOther' }, T0 + 2)
  const r = await h.resume(T0 + 3)
  assert.deepEqual(log, [])
  assert.equal(r.nextDueAt, undefined, 'waiting on a head sets no timer')
  await h.act('head.set', { head: 'did:key:z6MkHead' }, T0 + 4)
  await h.resume(T0 + 5)
  assert.deepEqual(log.map(([id]) => id), ['w'])
  assert.deepEqual((await read(store)).duties, {})
})

test('duties: handlers register by kind with their version; a missing or bad v throws at construction', async () => {
  const A = await side(0x07, 0x03)
  const mk = (h) => createHolder({ store: new InMemoryStore(), keys: A.keys }, { modules: [{ name: 'm', commands: {}, duties: { [KIND]: h } }] })
  await assert.rejects(mk({ apply: () => 'not-due' }), /version v/)
  await assert.rejects(mk({ v: 0, apply: () => 'not-due' }), /version v/)
  await assert.rejects(mk({ v: 1, awaitHolds: true, apply: () => 'not-due' }), /awaitHolds/)
  assert.equal(typeof (await mk({ v: 1, apply: () => 'not-due' })).resume, 'function')
})

test('duties: the codec keeps dueAt on known kinds and refuses a malformed one', async () => {
  const { decodeState } = await import('../dist/internal.js')
  const A = await side(0x07, 0x03)
  const B = await side(0x09, 0x05)
  const s = stateOf(A, B)
  s.duties.d1 = { kind: 'class-on', v: 1, id: 'd1', contactId: 'c1', relId: 'r1', cls: 'profile', dueAt: T0 }
  assert.equal(jcs(decodeState(s).duties.d1), jcs(s.duties.d1))
  s.duties.d1.dueAt = -1
  assert.throws(() => decodeState(s), /dueAt/)
})
