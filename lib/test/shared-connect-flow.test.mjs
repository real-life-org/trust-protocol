// The shared-connect flow machines (shared-connect-flow.ts): a full enactment through both
// machines without a transport, every delivery order, redelivery, decline, a restart from a
// snapshot, and the KeyProvider's encounter seeds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc, sharedConnectFlow as fl, seedKeys } from '../dist/index.js'
import { hkdf } from '../dist/crypto.js'

const te = new TextEncoder()
const seed = (label) => hkdf(te.encode('shared-connect flow test seed'), label)
const MED = { kind: 'tsp-mediator', address: 'did:webvh:QmUTUkdHgppiciLpqcxkTi6Pbc9VuZzWXvH4L2Dk2dY2WL:mediator.web-of-trust.de' }
const T0 = Date.parse('2026-11-08T15:00:00Z')
let n = 0
const newId = () => 'id-' + String(++n).padStart(4, '0')
const challenge = async (label) => sc.challengeOf16(await hkdf(te.encode('challenge'), label, 16))

async function setup () {
  const inviter = await sc.partyFromSeeds(await seed('inv/msg'), await seed('inv/pair'), [MED], 'Anton')
  const responder = await sc.partyFromSeeds(await seed('res/msg'), await seed('res/pair'), [MED], 'Day')
  const id = await challenge('inviter'), ch = await challenge('responder'), exp = Math.floor(T0 / 1000) + 600
  const link = await sc.sharedConnectLink({ from: inviter.messaging.did, id, exp, label: 'Anton' }, undefined, Math.floor(T0 / 1000))
  const read = await sc.readSharedConnectLink(link, Math.floor(T0 / 1000)); assert.ok(read.ok)
  const I = new fl.Inviter(inviter, { id, exp }, { newId })
  const R = new fl.Responder(responder, read.link, ch, 'scan', { newId })
  return { inviter, responder, id, ch, exp, read, I, R }
}
const kinds = (r) => r.events.map((e) => e.kind)

test('flow: a full enactment through both machines, the person accepting in between', async () => {
  const { inviter, responder, I, R, id, ch } = await setup()
  let t = T0
  const p = await R.start(t); assert.equal(p.send.length, 1); assert.equal(p.send[0].type, sc.TASK_PROPOSE)
  // inviter gets the propose, waits for the person
  const got = await I.receive(p.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(kinds(got), ['proposed']); assert.equal(got.send.length, 0)
  assert.equal(I.pending.name, 'Day'); assert.equal(I.pending.relationshipDid, responder.pair.anchor)
  const acc = await I.accept(t += 1000)
  assert.deepEqual(kinds(acc), ['accepted']); assert.deepEqual(acc.send.map((d) => d.type), [sc.TASK_PROPOSE + '#response', sc.TASK_ISSUE])
  assert.equal(acc.send[1].ceremony.step, 'issue-inviter'); assert.equal(acc.send[1].ceremony.enactment, id)
  assert.equal(I.pending, null)
  // responder: acceptance, then the inviter's credential; it issues on the acceptance and receipts the issue
  const a = await R.receive(acc.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(a), ['accepted']); assert.deepEqual(a.send.map((d) => d.ceremony.step), ['issue-responder'])
  assert.equal(a.send[0].ceremony.terminal, true)
  const i = await R.receive(acc.send[1], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(i), ['credential']); assert.equal(i.send[0].type, sc.TASK_ISSUE + '#response')
  assert.equal(i.events[0].vrc.credentialSubject.id, responder.pair.anchor)
  assert.equal(i.events[0].vrc.credentialSubject.challenge, ch, 'the subject\'s challenge')
  // inviter: the responder's issue and its receipt for ours
  const ri = await I.receive(a.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(kinds(ri), ['credential']); assert.equal(ri.send[0].type, sc.TASK_ISSUE + '#response')
  const rr = await I.receive(i.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(kinds(rr), ['receipted', 'complete']); assert.ok(rr.done && I.done)
  const rr2 = await R.receive(ri.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(rr2), ['receipted', 'complete']); assert.ok(rr2.done && R.done)
  assert.equal(I.theirPair, responder.pair.anchor); assert.equal(R.theirPair, inviter.pair.anchor)
})

test('flow: out-of-order delivery is held and taken; redelivery answers again; a second propose is refused', async () => {
  const { inviter, responder, I, R } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000)
  // the inviter's issue reaches the responder before the acceptance: held, then taken with the acceptance
  const held = await R.receive(acc.send[1], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(held), ['held']); assert.equal(held.send.length, 0)
  const a = await R.receive(acc.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(a), ['accepted', 'credential']); assert.deepEqual(a.send.map((d) => d.type), [sc.TASK_ISSUE, sc.TASK_ISSUE + '#response'])
  // the acceptance again: ignored, nothing sent; the issue again: the receipt again
  assert.deepEqual(kinds(await R.receive(acc.send[0], inviter.messaging.did, t += 1000)), ['ignored'])
  const again = await R.receive(acc.send[1], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(again), ['ignored']); assert.equal(again.send.length, 1); assert.equal(again.send[0].type, sc.TASK_ISSUE + '#response')
  // the propose again at the inviter: acceptance and issue go out again; another propose is refused
  const re = await I.receive(p.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(kinds(re), ['ignored']); assert.deepEqual(re.send.map((d) => d.type), [sc.TASK_PROPOSE + '#response', sc.TASK_ISSUE])
  const other = await sc.partyFromSeeds(await seed('x/msg'), await seed('x/pair'), [MED], 'X')
  const p2 = await sc.propose(other, inviter.messaging.did, I.snapshot().id, await challenge('x'), t)
  const r2 = await I.receive(p2, other.messaging.did, t += 1000)
  assert.deepEqual(r2.events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'second-propose' }])
  // a document whose issuer is not the TSP sender is refused before any check
  const r3 = await I.receive(a.send[0], other.messaging.did, t += 1000)
  assert.deepEqual(r3.events, [{ kind: 'refused', type: sc.TASK_ISSUE, reason: 'issuer' }])
  // an acceptance at a responder that has not proposed yet is refused; an inviter's issue before its
  // acceptance is held (above), a receipt before the own issue too
  const fresh = await setup()
  const early = await fresh.R.receive(acc.send[0], inviter.messaging.did, t)
  assert.deepEqual(early.events, [{ kind: 'refused', type: sc.TASK_PROPOSE + '#response', reason: 'before-propose' }])
  await fresh.R.start(t)
  assert.deepEqual(kinds(await fresh.R.receive(a.send[1], fresh.inviter.messaging.did, t)), ['held'])
})

test('flow: the person declines; the responder reads the decline and sends nothing more', async () => {
  const { inviter, responder, I, R } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const d = await I.decline(t += 1000)
  assert.deepEqual(kinds(d), ['declined']); assert.equal(d.send[0].payload.accept, false); assert.ok(d.done)
  await assert.rejects(() => I.accept(t), /nothing to accept/)
  const r = await R.receive(d.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(r), ['declined']); assert.equal(r.send.length, 0); assert.ok(r.done && R.declined && !R.done)
  // a tampered decline (another thread) is not a decline
  const R3 = (await setup()).R; await R3.start(t)
  const bad = await R3.receive({ ...d.send[0], threadId: 'other' }, inviter.messaging.did, t)
  assert.equal(bad.events[0].kind, 'refused')
})

test('flow: a restart from the snapshot continues with the same documents', async () => {
  const { inviter, responder, I, R, id, exp, read, ch } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000)
  // the inviter dies here; a new machine from the snapshot (the party derived again) answers the redelivery
  const I2 = new fl.Inviter(inviter, { id, exp }, { newId }, I.snapshot())
  const re = await I2.receive(p.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(re.send, acc.send, 'the same acceptance and issue, byte for byte')
  // the responder dies after start; the new machine proposes the same document again
  const R2 = new fl.Responder(responder, read.link, ch, 'scan', { newId }, R.snapshot())
  assert.deepEqual((await R2.start(t)).send, p.send)
  const a = await R2.receive(acc.send[0], inviter.messaging.did, t += 1000)
  const i = await R2.receive(acc.send[1], inviter.messaging.did, t += 1000)
  await I2.receive(a.send[0], responder.messaging.did, t += 1000)
  const done = await I2.receive(i.send[0], responder.messaging.did, t += 1000)
  assert.ok(done.done)
  assert.equal(JSON.parse(JSON.stringify(I2.snapshot())).role, 'inviter')
})

test('seedKeys.sharedConnectSeeds: two 32-byte seeds per 16-byte nonce, deterministic, distinct per nonce and purpose', async () => {
  const root = Uint8Array.from({ length: 64 }, (_, i) => i)
  const keys = seedKeys(root)
  const nonce = Uint8Array.from({ length: 16 }, (_, i) => 255 - i)
  const a = await keys.sharedConnectSeeds(nonce), b = await seedKeys(root).sharedConnectSeeds(nonce)
  assert.equal(a.messaging.length, 32); assert.equal(a.pair.length, 32)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a.messaging, a.pair)
  const c = await keys.sharedConnectSeeds(Uint8Array.from({ length: 16 }, (_, i) => i))
  assert.notDeepEqual(a.messaging, c.messaging)
  await assert.rejects(() => keys.sharedConnectSeeds(new Uint8Array(32)), /16 bytes/)
  // the seeds make a party whose identities come back after a restart
  const p1 = await sc.partyFromSeeds(a.messaging, a.pair, [MED], 'Anton')
  const p2 = await sc.partyFromSeeds(b.messaging, b.pair, [MED], 'Anton')
  assert.equal(p1.messaging.did, p2.messaging.did); assert.equal(p1.pair.anchor, p2.pair.anchor)
})
