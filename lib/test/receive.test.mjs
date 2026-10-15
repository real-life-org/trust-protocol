#!/usr/bin/env node
// receive (lib Stage 2, PR 3; note §4.3, Delivery §6.2, 4.2, 4.4): stages
// 1–4 once in the core, dispatch through the task register, the effect
// cache with its ack in one commit, the common ack path, the dispositions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, seal, jcs, xRawOfMk } from '../dist/index.js'
import { ackDocument, ackKeyOf, macAck } from '../dist/ack.js'
import { createEngine } from '../dist/engine.js'
import { InMemoryStore } from '../dist/testing.js'
import { NOTE, T0, pair, read, noteModule, side, stateOf } from './pair-fixture.mjs'

const ACK = 'https://real-life.org/trust-tasks/delivery-ack/0.1'

const send = async (h, input = {}, when = T0) => {
  const r = await h.act('note.send', input, when)
  assert.equal(r.ok, true)
  return r.outbound[0]
}

test('receive: two holders exchange a test-note end to end — unique with its ack; the ack back marks the item delivered', async () => {
  const seen = {}
  const { holderA, holderB, storeA, storeB, A, B } = await pair({ modules: (who) => [noteModule(who === 'B' ? seen : {})] })
  const out = await send(holderA, { text: 'hi' })
  assert.equal(out.recipient.keyAgreement, B.keyAgreement)
  const r = await holderB.receive(out.envelope, T0 + 1)
  assert.equal(r.disposition, 'unique')
  assert.equal(r.digest, out.digest)
  assert.equal(r.type, NOTE)
  assert.equal(r.outbound.length, 1)
  const ack = r.outbound[0]
  assert.equal(ack.type, ACK)
  assert.equal(ack.threadId, out.threadId)
  assert.equal(ack.attempt, 1)
  assert.deepEqual(ack.recipient, { contactId: 'c1', rkid: B.keyAgreement, keyAgreement: A.keyAgreement })
  assert.equal(ack.envelope.rkid, A.keyAgreement)
  assert.deepEqual(r.events.map((e) => e.type), ['profile.updated'])
  // the handler saw the decoded payload and the arrival tuple
  assert.deepEqual(seen.doc.payload, { text: 'hi' })
  assert.deepEqual(seen.arrival, { rkid: B.keyAgreement, threadId: out.threadId, digest: out.digest, when: T0 + 1 })
  // effect, record and ack in one commit
  const sB = await read(storeB)
  assert.equal(sB.commitSeq, '1')
  assert.equal(sB.encounter.records[seen.doc.id].text, 'hi')
  const eff = sB.effects[out.digest]
  assert.equal(eff.expiresAt, T0 + 1 + 90 * 86_400_000, 'key-retention = max(P90D, horizon)')
  assert.deepEqual(eff.ack, { digest: ack.digest, envelope: ack.envelope, threadId: out.threadId, recipient: ack.recipient, sent: false })
  assert.deepEqual(sB.outbox, {}, 'acks are outbox-less')

  // A receives the ack: delivered, a terminal cache entry, no ack of an ack
  const back = await holderA.receive(ack.envelope, T0 + 2)
  assert.equal(back.disposition, 'unique')
  assert.equal(back.type, ACK)
  assert.equal(back.digest, ack.digest)
  assert.deepEqual(back.outbound, [])
  assert.deepEqual(back.events.map((e) => [e.type, e.digest, e.status, e.late]), [['delivery.status', out.digest, 'delivered', false]])
  const sA = await read(storeA)
  assert.equal(sA.outbox[out.digest].history.at(-1).status, 'delivered')
  assert.equal(sA.outbox[out.digest].nextAttemptAt, undefined)
  assert.deepEqual(sA.effects[ack.digest], { ack: null, expiresAt: T0 + 2 + 90 * 86_400_000 })
  assert.equal((await holderA.deliveryStatus(out.digest)).items[0].status, 'delivered')

  // the ack again: duplicate-known, nothing to re-send
  const again = await holderA.receive(ack.envelope, T0 + 2)
  assert.deepEqual(again, { disposition: 'duplicate-known', digest: ack.digest, outbound: [] })
})

test('receive: a duplicate re-sends the stored ack byte-identical and commits nothing beyond lastWhen', async () => {
  const { holderA, holderB, storeB } = await pair()
  const out = await send(holderA)
  const r1 = await holderB.receive(out.envelope, T0 + 10)
  const s1 = await read(storeB)
  const r2 = await holderB.receive(out.envelope, T0 + 5)
  assert.equal(r2.disposition, 'duplicate-known')
  assert.equal(r2.digest, out.digest)
  assert.equal(jcs(r2.outbound[0].envelope), jcs(r1.outbound[0].envelope), 'the very ack bytes')
  assert.equal(r2.outbound[0].digest, r1.outbound[0].digest)
  assert.equal(r2.outbound[0].attempt, 2)
  assert.equal(jcs(await read(storeB)), jcs(s1), 'no commit at a lower when')
  // a re-sealed redelivery of the same document is the same document
  const r3 = await holderB.receive(out.envelope, T0 + 20)
  assert.equal(r3.disposition, 'duplicate-known')
  const s3 = await read(storeB)
  assert.equal(s3.commitSeq, String(BigInt(s1.commitSeq) + 1n), 'a higher when commits lastWhen only')
  assert.equal(s3.lastWhen, T0 + 20)
  assert.equal(jcs({ ...s3, commitSeq: s1.commitSeq, lastWhen: s1.lastWhen }), jcs(s1))
})

test('receive: wrong recipient, malformed, unknown type and a decode refusal fail at their stage and commit nothing', async () => {
  const { holderA, holderB, storeB, A } = await pair()
  const s0 = jcs(await read(storeB))
  const cases = [
    [{ override: { recipient: A.anchor } }, 'wrong-recipient', 5],
    [{ drop: ['threadId'] }, 'malformed', 5],
    [{ override: { issuedAt: '2026-02-30T00:00:00Z' } }, 'malformed', 5],
    [{ override: { type: 'https://real-life.org/trust-tasks/test-other/0.1' } }, 'unknown-type', 6],
    [{ override: { type: 'https://real-life.org/trust-tasks/test-note/0.2' } }, 'unknown-type', 6],
    [{ payload: { note: 'x' } }, 'malformed', 7],
    [{ payload: { text: 5 } }, 'validation-failed', 8],
    [{ override: { issuer: A.anchor.slice(0, -1) + (A.anchor.endsWith('a') ? 'b' : 'a') } }, 'validation-failed', 8],
    [{ text: 'refuse' }, 'validation-failed', 9],
  ]
  for (const [input, reason, stage] of cases) {
    const out = await send(holderA, input)
    const r = await holderB.receive(out.envelope, T0 + 1)
    assert.deepEqual(r, { disposition: 'failed', reason, stage, digest: out.digest }, JSON.stringify(input))
  }
  const garbage = await holderB.receive({ rkid: 'x', epk: 'y', nonce: 'z', ciphertext: 'w' }, T0 + 1)
  assert.deepEqual(garbage, { disposition: 'failed', reason: 'malformed', stage: 2 })
  assert.deepEqual(await holderB.receive(undefined, T0 + 1), { disposition: 'failed', reason: 'malformed', stage: 2 })
  assert.deepEqual(await holderB.receive({ toJSON () { throw new Error('x') } }, T0 + 1), { disposition: 'failed', reason: 'malformed', stage: 2 })
  assert.equal(jcs(await read(storeB)), s0, 'no failure commits anything, lastWhen included')
  // a refused digest stays uncached: the handler refusal is not an effect
  const out = await send(holderA, { text: 'refuse' })
  assert.equal((await holderB.receive(out.envelope, T0 + 1)).reason, 'validation-failed')
  assert.equal((await holderB.receive(out.envelope, T0 + 1)).reason, 'validation-failed')
})

test('receive: an envelope to a retired key is decryption-failed (stage 3); to an unknown key malformed (stage 2)', async () => {
  const retired = await pair({ b: { address: 'tombstone' } })
  const out = await send(retired.holderA)
  assert.deepEqual(await retired.holderB.receive(out.envelope, T0 + 1), { disposition: 'failed', reason: 'decryption-failed', stage: 3, key: 'retired' })
  const unknown = await pair({ b: { address: 'none' } })
  const out2 = await send(unknown.holderA)
  assert.deepEqual(await unknown.holderB.receive(out2.envelope, T0 + 1), { disposition: 'failed', reason: 'malformed', stage: 2, key: 'unknown' })
})

test('receive: acks are checked against what this holder sent — forged MAC, foreign ref, other thread are validation-failed', async () => {
  const { holderA, holderB, storeA, A, B } = await pair()
  const out = await send(holderA)
  const S = globalThis.crypto.subtle
  const forge = async (f, key) => {
    const doc = ackDocument({ id: '7b1c9c1e-4d5a-4a4a-9d5e-000000000001', issuer: B.anchor, recipient: A.anchor, threadId: out.threadId, issuedAt: '2026-10-15T09:00:00Z', ref: out.digest, ...f })
    return seal(await macAck(doc, key ?? new Uint8Array(32).fill(1)), A.keyAgreement)
  }
  // the right key, derived as B would derive it
  const rel = (await B.keys.agree(B.keyAgreement, xRawOfMk(A.keyAgreement), () => ({ status: 'live', label: B.label })))
  const k = await ackKeyOf(rel.shared, B.anchor, A.anchor)
  const s0 = jcs(await read(storeA))
  for (const [env, why] of [
    [await forge({}), 'wrong MAC key'],
    [await forge({ ref: 'uEiByzW6EIsQH-20JhpDxEwt97X7C9_Xh0wvZ1SHwFTY3kw' }, k), 'ref never sent'],
    [await forge({ threadId: '7b1c9c1e-4d5a-4a4a-9d5e-000000000009' }, k), 'other thread'],
  ]) {
    const r = await holderA.receive(env, T0 + 1)
    assert.deepEqual([r.disposition, r.reason, r.stage], ['failed', 'validation-failed', 8], why)
  }
  assert.equal(jcs(await read(storeA)), s0, 'sender status unchanged')
  // the honest ack under k verifies
  const ok = await holderA.receive(await forge({}, k), T0 + 1)
  assert.equal(ok.disposition, 'unique')
  void holderB
})

test('receive: an ack after the holder gave up marks the item delivered, late', async () => {
  const { holderA, holderB, storeA } = await pair({ retry: { horizonMs: 86_400_000, backoff: () => 1000 } })
  const out = await send(holderA)
  const r = await holderB.receive(out.envelope, T0 + 1)
  await holderA.resume(T0 + 86_400_000)
  assert.equal((await read(storeA)).outbox[out.digest].history.at(-1).status, 'failed')
  const back = await holderA.receive(r.outbound[0].envelope, T0 + 86_400_001)
  assert.equal(back.events[0].late, true)
  assert.equal((await read(storeA)).outbox[out.digest].history.at(-1).late, true)
})

test('receive: restart between the receive commit and the ack send — resume on a new holder re-emits the ack until it is reported', async () => {
  const { holderA, holderB, storeB, B } = await pair()
  const out = await send(holderA)
  const r = await holderB.receive(out.envelope, T0 + 1)
  // the process dies before the app sends r.outbound; a new holder over the store
  const again = await createHolder({ store: storeB, keys: B.keys }, { modules: [noteModule()] })
  const res = await again.resume(T0 + 2)
  assert.equal(res.outbound.length, 1)
  assert.equal(jcs(res.outbound[0].envelope), jcs(r.outbound[0].envelope))
  assert.equal(res.outbound[0].digest, r.outbound[0].digest)
  assert.equal(res.outbound[0].attempt, 2)
  assert.equal(res.nextDueAt, undefined, 'an unsent ack sets no timer')
  // the app sends it and reports: sent, never re-emitted again
  const rep = await again.report({ digest: r.outbound[0].digest, status: 'accepted' }, T0 + 3)
  assert.deepEqual(rep, { ok: true, outbound: [], events: [] })
  assert.equal((await read(storeB)).effects[out.digest].ack.sent, true)
  assert.deepEqual((await again.resume(T0 + 4)).outbound, [])
  const seq = (await read(storeB)).commitSeq
  assert.deepEqual(await again.report({ digest: r.outbound[0].digest, status: 'delivered', late: false }, T0 + 4), { ok: true, outbound: [], events: [] })
  assert.equal((await read(storeB)).commitSeq, seq, 'a second report on the ack changes nothing')
  // a duplicate still re-sends the stored ack, sent or not
  assert.equal(jcs((await again.receive(out.envelope, T0 + 4)).outbound[0].envelope), jcs(r.outbound[0].envelope))
})

test('receive: the task register — full URIs only, acks and signature-class types are not registrable, decode is required', async () => {
  const keys = (await side(1, 1)).keys
  const reg = (tasks) => createEngine({ store: new InMemoryStore(), keys }, [{ name: 'm', commands: {}, tasks }])
  const h = { decode: (p) => p, apply: (s) => ({ state: s }) }
  await assert.rejects(reg({ 'https://real-life.org/trust-tasks/delivery-ack/0.1': h }), /built in/)
  await assert.rejects(reg({ 'https://real-life.org/trust-tasks/encounter-bundle/0.1': h }), /signature-class/)
  await assert.rejects(reg({ [NOTE]: { apply: h.apply } }), /decode and apply/)
  await assert.rejects(createEngine({ store: new InMemoryStore(), keys }, [{ name: 'm', commands: { receive: { human: false, apply: (s) => ({ state: s }) } } }]), /duplicate command/)
  const e = await reg({ [NOTE]: h })
  assert.deepEqual(e.registry.tasks, [NOTE])
})

test('receive: a handler that writes the effect cache is a programming error; nothing commits', async () => {
  const { holderA, holderB, storeB } = await pair()
  const s0 = jcs(await read(storeB))
  const out = await send(holderA, { text: 'cache' })
  await assert.rejects(holderB.receive(out.envelope, T0 + 1), /wrote the effect cache/)
  assert.equal(jcs(await read(storeB)), s0)
})

test('receive: a document on an rkid without a tuple is validation-failed at the closed acceptance binding', async () => {
  const A = await side(0x07, 0x03)
  const B = await side(0x09, 0x05)
  const s = stateOf(B, A)
  delete s.relationships.r1
  delete s.contacts.c1
  s.entryOrder.heads = []
  const store = new InMemoryStore()
  await store.commit(null, s)
  const hB = await createHolder({ store, keys: B.keys }, { modules: [noteModule()] })
  const { holderA } = await pair()
  const out = await send(holderA)
  assert.deepEqual(await hB.receive(out.envelope, T0 + 1), { disposition: 'failed', reason: 'validation-failed', stage: 8, digest: out.digest })
})
