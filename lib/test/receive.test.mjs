#!/usr/bin/env node
// receive (lib Stage 2, PR 3; note §4.3, Delivery §6.2, 4.2, 4.4): stages
// 1–4 once in the core, dispatch through the task register, the effect
// cache with its ack in one commit, the common ack path, the dispositions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, seal, jcs, xRawOfMk } from '../dist/index.js'
import { ackDocument, ackKeyOf, macAck } from '../dist/ack.js'
import { createEngine, ENGINE_DEFAULTS } from '../dist/engine.js'
import { InMemoryStore } from '../dist/testing.js'
import { NOTE, T0, DAY, pair, read, noteModule, side, stateOf } from './pair-fixture.mjs'

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
  assert.deepEqual(eff.ack, {
    digest: ack.digest, envelope: ack.envelope, threadId: out.threadId, recipient: ack.recipient,
    sent: false, at: T0 + 1, attempt: 1, nextAttemptAt: T0 + 1 + ENGINE_DEFAULTS.backoff(1),
  })
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
  const due1 = T0 + 1 + ENGINE_DEFAULTS.backoff(1)
  const early = await again.resume(T0 + 2)
  assert.deepEqual(early.outbound, [], 'not before its backoff')
  assert.equal(early.nextDueAt, due1, 'the unsent ack sets the timer')
  const res = await again.resume(due1)
  assert.equal(res.outbound.length, 1)
  assert.equal(jcs(res.outbound[0].envelope), jcs(r.outbound[0].envelope))
  assert.equal(res.outbound[0].digest, r.outbound[0].digest)
  assert.equal(res.outbound[0].attempt, 2)
  assert.equal(res.nextDueAt, due1 + ENGINE_DEFAULTS.backoff(2))
  const st = (await read(storeB)).effects[out.digest].ack
  assert.deepEqual([st.attempt, st.nextAttemptAt], [2, due1 + ENGINE_DEFAULTS.backoff(2)])
  // the app sends it and reports: sent, never re-emitted again
  const rep = await again.report({ digest: r.outbound[0].digest, status: 'accepted' }, due1 + 1)
  assert.deepEqual(rep, { ok: true, outbound: [], events: [] })
  const sent = (await read(storeB)).effects[out.digest].ack
  assert.deepEqual([sent.sent, sent.sentBy, sent.nextAttemptAt], [true, 'report', undefined])
  const after = await again.resume(due1 + 10 * DAY)
  assert.deepEqual(after.outbound, [])
  assert.equal(after.nextDueAt, undefined)
  const seq = (await read(storeB)).commitSeq
  assert.deepEqual(await again.report({ digest: r.outbound[0].digest, status: 'delivered', late: false }, due1 + 10 * DAY), { ok: true, outbound: [], events: [] })
  assert.equal((await read(storeB)).commitSeq, seq, 'a second report on the ack changes nothing')
  // a duplicate still re-sends the stored ack, sent or not
  assert.equal(jcs((await again.receive(out.envelope, due1 + 10 * DAY)).outbound[0].envelope), jcs(r.outbound[0].envelope))
})

test('receive: an unsent ack retries on the retry policy and is given up at the horizon (marked sent by the horizon)', async () => {
  const retry = { horizonMs: DAY, backoff: (n) => 1000 * n }
  const { holderA, holderB, storeB } = await pair({ retry })
  const out = await send(holderA)
  const r = await holderB.receive(out.envelope, T0)
  assert.equal((await holderB.resume(T0 + 999)).outbound.length, 0)
  const a2 = await holderB.resume(T0 + 1000)
  assert.deepEqual(a2.outbound.map((o) => [o.digest, o.attempt]), [[r.outbound[0].digest, 2]])
  assert.equal(a2.nextDueAt, T0 + 1000 + 2000)
  assert.equal((await holderB.resume(T0 + 2999)).outbound.length, 0)
  assert.equal((await holderB.resume(T0 + 3000)).outbound[0].attempt, 3)
  // the duplicate's re-send does not move the schedule
  const dup = await holderB.receive(out.envelope, T0 + 3001)
  assert.equal(dup.outbound[0].attempt, 4)
  assert.equal((await read(storeB)).effects[out.digest].ack.attempt, 3)
  // the horizon: the holder stops offering it
  const end = await holderB.resume(T0 + DAY)
  assert.deepEqual(end.outbound, [])
  assert.equal(end.nextDueAt, undefined)
  const ack = (await read(storeB)).effects[out.digest].ack
  assert.deepEqual([ack.sent, ack.sentBy, ack.nextAttemptAt], [true, 'horizon', undefined])
  assert.equal(jcs((await holderB.receive(out.envelope, T0 + DAY)).outbound[0].envelope), jcs(r.outbound[0].envelope), 'a redelivery still earns it')
})

test('receive: a resource-limit discard commits its state as the disposition discarded — no cache, no ack; a refusal from apply commits nothing', async () => {
  const { holderA, holderB, storeB } = await pair()
  const refused = await send(holderA, { text: 'refuse' })
  const seq0 = (await read(storeB)).commitSeq
  assert.equal((await holderB.receive(refused.envelope, T0 + 1)).disposition, 'failed')
  assert.equal((await read(storeB)).commitSeq, seq0, 'a refusal commits nothing')
  const out = await send(holderA, { text: 'discard' })
  const seq = (await read(storeB)).commitSeq
  const r = await holderB.receive(out.envelope, T0 + 1)
  assert.deepEqual(r, { disposition: 'discarded', digest: out.digest, type: NOTE, reason: 'resource-limit', ref: 'RLTP-TRU-5365' })
  const s = await read(storeB)
  assert.equal(s.commitSeq, String(BigInt(seq) + 1n), 'the discard record commits')
  assert.equal(Object.values(s.encounter.records)[0].discarded, true)
  assert.equal(Object.hasOwn(s.effects, out.digest), false, 'not cached: a redelivery is evaluated afresh')
})

test('receive: a verified ack runs the issuing module\'s ack handler in its transaction; a delivered report does not', async () => {
  const calls = []
  const onAck = (state, ref, when) => { calls.push([ref, when]); return { state: { ...state, encounter: { ...state.encounter, records: { ...state.encounter.records, ['ack:' + ref]: { at: when } } } } } }
  const { holderA, holderB, storeA } = await pair({ modules: () => [noteModule({}, { onAck })] })
  const out = await send(holderA, { text: 'hi' })
  const other = await send(holderA, { text: 'two' })
  await holderA.report({ digest: other.digest, status: 'delivered', late: false }, T0 + 1)
  assert.deepEqual(calls, [], 'an adapter report never completes')
  const r = await holderB.receive(out.envelope, T0 + 1)
  const back = await holderA.receive(r.outbound[0].envelope, T0 + 2)
  assert.equal(back.disposition, 'unique')
  assert.deepEqual(calls, [[out.digest, T0 + 2]])
  const s = await read(storeA)
  assert.deepEqual(s.encounter.records['ack:' + out.digest], { at: T0 + 2 })
  assert.equal(s.outbox[out.digest].history.at(-1).status, 'delivered')
})

test('engine: an item turning failed runs its module\'s failure handler in that transaction — on a failed report and on the holder\'s give-up at the horizon, once; its duties fold into the state', async () => {
  const calls = []
  const onFailed = (state, ref, when) => {
    calls.push([ref, when])
    return { state, events: [{ type: 'profile.updated', contactId: null }], duties: [{ kind: 'x-retry', v: 1, id: 'retry', ref }, { kind: 'x-retry', v: 1, id: 'retry', ref: 'again' }] }
  }
  const { holderA, storeA } = await pair({ modules: () => [noteModule({}, { onFailed })] })
  const one = await send(holderA, { text: 'one' })
  const two = await send(holderA, { text: 'two' })
  await holderA.report({ digest: one.digest, status: 'accepted' }, T0 + 1)
  assert.deepEqual(calls, [])
  const r = await holderA.report({ digest: one.digest, status: 'failed', reason: 'unroutable' }, T0 + 2)
  assert.deepEqual(calls, [[one.digest, T0 + 2]])
  assert.deepEqual(r.events.map((e) => e.type), ['delivery.status', 'profile.updated'])
  assert.deepEqual((await read(storeA)).duties.retry, { kind: 'x-retry', v: 1, id: 'retry', ref: one.digest }, 'folded once; an id already open is kept')
  await holderA.report({ digest: one.digest, status: 'failed', reason: 'unroutable' }, T0 + 3)
  assert.equal(calls.length, 1, 'only at the transition')
  // the give-up at the horizon inside resume
  const g = await holderA.resume(T0 + 8 * DAY)
  assert.deepEqual(calls.map((c) => c[0]), [one.digest, two.digest])
  assert.ok(g.events.some((e) => e.type === 'profile.updated'))
  await assert.rejects(createHolder({ store: new InMemoryStore(), keys: (await side(1, 2)).keys }, { modules: [noteModule({}, { onFailed }), { name: 'n2', commands: {}, failures: { [NOTE]: onFailed } }] }), /duplicate failure handler/)
})

test('receive: the task register — full URIs only, acks are not registrable, decode is required, channel a function', async () => {
  const keys = (await side(1, 1)).keys
  const reg = (tasks) => createEngine({ store: new InMemoryStore(), keys }, [{ name: 'm', commands: {}, tasks }])
  const h = { proof: 'absent', decode: (p) => p, apply: (s) => ({ state: s }) }
  await assert.rejects(reg({ 'https://real-life.org/trust-tasks/delivery-ack/0.1': h }), /built in/)
  await assert.rejects(reg({ [NOTE]: { ...h, channel: 'tuple' } }), /channel must be a function/)
  // a signature-class type registers: its ack is the signed form (PR 7)
  assert.deepEqual((await reg({ 'https://real-life.org/trust-tasks/encounter-bundle/0.1': h })).registry.tasks, ['https://real-life.org/trust-tasks/encounter-bundle/0.1'])
  await assert.rejects(reg({ [NOTE]: { proof: 'absent', apply: h.apply } }), /decode and apply/)
  await assert.rejects(reg({ [NOTE]: { decode: h.decode, apply: h.apply } }), /proof/)
  await assert.rejects(reg({ [NOTE]: { ...h, proof: 'optional' } }), /proof/)
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

test('receive: the registry entry\'s proof declaration — a proof on a type declared absent is validation-failed at stage 6, no commit, no ack', async () => {
  const { holderA, holderB, storeB } = await pair()
  const s0 = jcs(await read(storeB))
  const out = await send(holderA, { override: { proof: { mac: 'u' + 'A'.repeat(43) } } })
  assert.deepEqual(await holderB.receive(out.envelope, T0 + 1), { disposition: 'failed', reason: 'validation-failed', stage: 6, digest: out.digest })
  assert.equal(jcs(await read(storeB)), s0)
  // a type declaring its proof required refuses a document without one
  const required = (who) => {
    const m = noteModule()
    return who === 'B' ? [{ ...m, tasks: { [NOTE]: { ...m.tasks[NOTE], proof: 'required' } } }] : [m]
  }
  const p2 = await pair({ modules: required })
  const out2 = await send(p2.holderA)
  assert.deepEqual(await p2.holderB.receive(out2.envelope, T0 + 1), { disposition: 'failed', reason: 'validation-failed', stage: 6, digest: out2.digest })
})

// ── review round 1 ────────────────────────────────────────────────────

test('receive: a cryptographically valid ack arriving on another tuple (another own rkid) is rejected; the outbox is unchanged', async () => {
  const A1 = await side(0x07, 0x03)
  const A2 = await side(0x07, 0x04)
  const B1 = await side(0x09, 0x05)
  const B2 = await side(0x09, 0x06)
  const s = stateOf(A1, B1)
  const s2 = stateOf(A2, B2, { rel: 'r2', contact: 'c2' })
  s.relationships.r2 = s2.relationships.r2
  s.contacts.c2 = { ...s2.contacts.c2, pos: '1' }
  s.addresses.keys[A2.keyAgreement] = s2.addresses.keys[A2.keyAgreement]
  s.register.labels.push(A2.label)
  s.entryOrder = { nextPos: '2', heads: ['r1', 'r2'] }
  const storeA = new InMemoryStore()
  await storeA.commit(null, s)
  const hA = await createHolder({ store: storeA, keys: A1.keys }, { modules: [noteModule()] })
  const out = await send(hA, { rel: 'r1' })
  const ackOn = async (me, them) => {
    const sh = await me.keys.agree(me.keyAgreement, xRawOfMk(them.keyAgreement), () => ({ status: 'live', label: me.label }))
    const k = await ackKeyOf(sh.shared, me.anchor, them.anchor)
    const doc = ackDocument({ id: '7b1c9c1e-4d5a-4a4a-9d5e-000000000003', issuer: me.anchor, recipient: them.anchor, threadId: out.threadId, issuedAt: '2026-10-15T09:00:01Z', ref: out.digest })
    return seal(await macAck(doc, k), them.keyAgreement)
  }
  const before = jcs((await read(storeA)).outbox)
  const r = await hA.receive(await ackOn(B2, A2), T0 + 1)
  assert.deepEqual([r.disposition, r.reason, r.stage], ['failed', 'validation-failed', 8])
  assert.equal(jcs((await read(storeA)).outbox), before, 'sender status unchanged')
  // the same ack on the tuple the document went out on is accepted
  const ok = await hA.receive(await ackOn(B1, A1), T0 + 1)
  assert.equal(ok.disposition, 'unique')
  assert.equal((await read(storeA)).outbox[out.digest].history.at(-1).status, 'delivered')
})

test('receive: a CAS conflict between preparation and commit re-runs the stages; the effect cache is re-checked, one commit', async () => {
  const { holderA, storeB, B } = await pair()
  const out = await send(holderA)
  const other = await createHolder({ store: storeB, keys: B.keys }, { modules: [noteModule()] })
  let calls = 0
  let otherResult
  const hooked = {
    anchorOf: (l) => B.keys.anchorOf(l),
    sign: (l, b) => B.keys.sign(l, b),
    carrierPrincipal: (n, c) => B.keys.carrierPrincipal(n, c),
    async agree (rkid, epk, allowed) {
      calls++
      // the other writer receives the same envelope and commits in between
      if (calls === 1) otherResult = await other.receive(out.envelope, T0 + 1)
      return B.keys.agree(rkid, epk, allowed)
    },
  }
  const h = await createHolder({ store: storeB, keys: hooked }, { modules: [noteModule()] })
  const seq0 = (await read(storeB)).commitSeq
  const r = await h.receive(out.envelope, T0 + 1)
  assert.equal(otherResult.disposition, 'unique')
  assert.equal(r.disposition, 'duplicate-known', 'stage 4 found the other writer\'s effect')
  assert.equal(jcs(r.outbound[0].envelope), jcs(otherResult.outbound[0].envelope), 'its stored ack')
  assert.ok(calls >= 2, 'the stages ran again')
  assert.equal((await read(storeB)).commitSeq, String(BigInt(seq0) + 1n), 'exactly one commit')
})

class ThrowAfterCommit extends InMemoryStore {
  armed = false
  async commit (version, next) {
    const r = await super.commit(version, next)
    if (this.armed) { this.armed = false; throw new Error('response lost') }
    return r
  }
}

test('receive: an unknown commit outcome — the next call settles, finds the effect and re-sends the stored ack', async () => {
  const { holderA, A, B } = await pair()
  const store = new ThrowAfterCommit()
  await store.commit(null, stateOf(B, A))
  const hB = await createHolder({ store, keys: B.keys }, { modules: [noteModule()] })
  const seen = []
  hB.subscribe((c) => seen.push(c))
  const out = await send(holderA)
  store.armed = true
  await assert.rejects(hB.receive(out.envelope, T0 + 1), (e) => e.code === 'unknown-commit-outcome')
  assert.equal(seen.length, 0)
  const stored = (await read(store)).effects[out.digest].ack
  const again = await hB.receive(out.envelope, T0 + 1)
  assert.deepEqual(seen.map((c) => c.events.map((e) => e.type)), [['profile.updated']], 'the landed commit is announced on settling')
  assert.equal(again.disposition, 'duplicate-known')
  assert.equal(jcs(again.outbound[0].envelope), jcs(stored.envelope))
  assert.equal(again.outbound[0].digest, stored.digest)
})

test('receive: an effect past expiresAt but not yet removed by tick still answers duplicate-known', async () => {
  const { holderA, holderB, storeB } = await pair()
  const out = await send(holderA)
  const r = await holderB.receive(out.envelope, T0)
  const late = T0 + 90 * DAY + 5
  assert.ok((await read(storeB)).effects[out.digest].expiresAt < late)
  const again = await holderB.receive(out.envelope, late)
  assert.equal(again.disposition, 'duplicate-known')
  assert.equal(jcs(again.outbound[0].envelope), jcs(r.outbound[0].envelope))
})

// ── the signed ack path and the channel binding (PR 7) ─────────────────

const SIG = 'https://real-life.org/trust-tasks/x-introduction-offer/0.1'

/** A module sending and receiving SIG, a signature-class type: its acks
 *  are signed (Delivery 4.2/4.4). `channel`: bind without a tuple, to the
 *  key agreement the payload names. */
const sigModule = (seen = {}, { channel = false } = {}) => {
  const base = noteModule(seen)
  const send = base.commands['note.send']
  return {
    name: 'sig',
    commands: {
      'sig.send': {
        human: false,
        prepare: (ctx, input) => send.prepare(ctx, { ...input, override: { type: SIG, ...(input.override ?? {}) } }),
        apply: (state, p) => {
          const v = p.value
          return { state, outbound: [{ digest: v.digest, envelope: v.envelope, type: SIG, threadId: v.threadId, recipient: { contactId: v.contactId, rkid: v.rkid, keyAgreement: v.keyAgreement } }] }
        },
      },
    },
    tasks: {
      [SIG]: {
        ...base.tasks[NOTE],
        ...(channel ? { channel: (state, doc) => (doc.payload.text === 'unbound' ? { ok: false, reason: 'validation-failed', ref: 'TEST-1' } : { keyAgreement: seen.peerKa, contactId: 'c-new' }) } : {}),
      },
    },
  }
}

test('receive: a signature-class document earns a SIGNED ack under the own anchor; the sender verifies it under the issuer and marks the item delivered', async () => {
  const seen = {}
  const { holderA, holderB, storeA, A, B } = await pair({ modules: () => [sigModule(seen)] })
  const r = await holderA.act('sig.send', {}, T0)
  const out = r.outbound[0]
  const got = await holderB.receive(out.envelope, T0 + 1)
  assert.equal(got.disposition, 'unique')
  const ack = got.outbound[0]
  assert.equal(ack.type, ACK)
  const { openFor } = await import('./pair-fixture.mjs')
  const doc = await openFor(A, ack.envelope)
  assert.equal(doc.proof.type, 'DataIntegrityProof')
  assert.equal(doc.proof.mac, undefined)
  assert.equal(doc.issuer, B.anchor)
  const { diVerify } = await import('../dist/index.js')
  assert.equal(await diVerify(doc, B.anchor), true, 'an attestation under the recipient anchor (4.2)')
  const back = await holderA.receive(ack.envelope, T0 + 2)
  assert.equal(back.disposition, 'unique')
  assert.equal((await read(storeA)).outbox[out.digest].history.at(-1).status, 'delivered')
})

test('receive: the ack form follows the acked document\'s class — a MAC ack for a signature-class item and a signed ack for a DV item are validation-failed', async () => {
  const { holderA, A, B, storeA } = await pair({ modules: () => [sigModule(), noteModule()] })
  const sig = (await holderA.act('sig.send', {}, T0)).outbound[0]
  const dv = (await holderA.act('note.send', {}, T0)).outbound[0]
  const rel = await B.keys.agree(B.keyAgreement, xRawOfMk(A.keyAgreement), () => ({ status: 'live', label: B.label }))
  const k = await ackKeyOf(rel.shared, B.anchor, A.anchor)
  const base = (o) => ackDocument({ id: '7b1c9c1e-4d5a-4a4a-9d5e-000000000002', issuer: B.anchor, recipient: A.anchor, threadId: o.threadId, issuedAt: '2026-10-15T09:00:00Z', ref: o.digest })
  const { diSignWith } = await import('../dist/index.js')
  const signedFor = (o) => diSignWith(B.anchor, (b) => B.keys.sign(B.label, b), base(o), '2026-10-15T09:00:00Z')
  const s0 = jcs(await read(storeA))
  for (const [env, why] of [
    [await seal(await macAck(base(sig), k), A.keyAgreement), 'MAC ack of a signature-class document'],
    [await seal(await signedFor(dv), A.keyAgreement), 'signed ack of a DV document'],
    [await seal({ ...(await signedFor(sig)), issuer: A.anchor }, A.keyAgreement), 'signed ack whose issuer is not the recipient'],
  ]) {
    const r = await holderA.receive(env, T0 + 1)
    assert.deepEqual([r.disposition, r.reason, r.stage], ['failed', 'validation-failed', 8], why)
  }
  assert.equal(jcs(await read(storeA)), s0)
  assert.equal((await holderA.receive(await seal(await signedFor(sig), A.keyAgreement), T0 + 1)).disposition, 'unique')
  assert.equal((await holderA.receive(await seal(await macAck(base(dv), k), A.keyAgreement), T0 + 1)).disposition, 'unique')
})

test('receive: a channel binding accepts a document on an own key no tuple carries and seals its ack to the key agreement the handler names; its refusal fails at stage 8', async () => {
  const A = await side(0x07, 0x03)
  const B = await side(0x09, 0x05)
  const s = stateOf(B, A)
  delete s.relationships.r1
  delete s.contacts.c1
  s.entryOrder.heads = []
  const store = new InMemoryStore()
  await store.commit(null, s)
  const seen = { peerKa: A.keyAgreement }
  const hB = await createHolder({ store, keys: B.keys }, { modules: [sigModule(seen, { channel: true })] })
  const { holderA } = await pair({ modules: () => [sigModule()] })
  const out = (await holderA.act('sig.send', {}, T0)).outbound[0]
  const r = await hB.receive(out.envelope, T0 + 1)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(r.outbound[0].recipient, { contactId: 'c-new', rkid: B.keyAgreement, keyAgreement: A.keyAgreement })
  const refused = (await holderA.act('sig.send', { text: 'unbound' }, T0)).outbound[0]
  assert.deepEqual(await hB.receive(refused.envelope, T0 + 1), { disposition: 'failed', reason: 'validation-failed', stage: 8, digest: refused.digest, ref: 'TEST-1' })
})
