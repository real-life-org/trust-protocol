// The shared-connect flow machines (shared-connect-flow.ts): a full enactment through both
// machines without a transport, every delivery order, redelivery, decline, a restart from a
// snapshot, and the KeyProvider's encounter seeds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sharedConnect as sc, sharedConnectFlow as fl, seedKeys } from '../dist/index.js'
import { readTrustTaskError } from '../dist/adapters/vti-mediator.js'
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
  const acc = await I.accept(t += 1000, 'displayed')
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
  assert.deepEqual(kinds(rr), ['receipted', 'complete']); assert.ok(rr.finished && I.complete)
  const rr2 = await R.receive(ri.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(rr2), ['receipted', 'complete']); assert.ok(rr2.finished && R.complete)
  assert.equal(I.theirPair, responder.pair.anchor); assert.equal(R.theirPair, inviter.pair.anchor)
})

test('flow: out-of-order delivery is held and taken; redelivery answers again; a second propose is refused', async () => {
  const { inviter, responder, I, R } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000, 'displayed')
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
  assert.deepEqual(r2.events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'issuer' }], 'another sender is refused before anything else')
  const p3 = await sc.propose(responder, inviter.messaging.did, I.snapshot().id, await challenge('x3'), t)
  const r4 = await I.receive(p3, responder.messaging.did, t += 1000)
  assert.deepEqual(r4.events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'second-propose' }], 'the same sender proposing again: the handle is spent')
  // a document whose issuer is not the TSP sender is refused before any check
  const r3 = await I.receive(a.send[0], other.messaging.did, t += 1000)
  assert.deepEqual(r3.events, [{ kind: 'refused', type: sc.TASK_ISSUE, reason: 'issuer' }])
  // an acceptance at a responder that has not proposed yet is refused; an inviter's issue before its
  // acceptance is held (above), a receipt before the own issue too
  const fresh = await setup()
  const fp = await fresh.R.start(t)
  await fresh.I.receive(fp.send[0], fresh.responder.messaging.did, t)
  const facc = await fresh.I.accept(t, 'displayed')
  const R0 = new fl.Responder(fresh.responder, fresh.read.link, fresh.ch, 'scan', { newId })
  const early = await R0.receive(facc.send[0], fresh.inviter.messaging.did, t)
  assert.deepEqual(early.events, [{ kind: 'refused', type: sc.TASK_PROPOSE + '#response', reason: 'before-propose' }])
  // the inviter's issue before the acceptance is held, once; a second copy is a duplicate
  assert.deepEqual(kinds(await fresh.R.receive(facc.send[1], fresh.inviter.messaging.did, t)), ['held'])
  assert.deepEqual(kinds(await fresh.R.receive(facc.send[1], fresh.inviter.messaging.did, t)), ['ignored'])
})

test('flow: the person declines with the registry error document; the responder reads it; forgeries fail', async () => {
  const { inviter, responder, I, R } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const d = await I.decline(t += 1000, 'Not now')
  assert.deepEqual(kinds(d), ['declined']); assert.ok(d.finished && I.finished && I.declined && !I.complete)
  const doc = d.send[0]
  assert.equal(doc.type, sc.TASK_ERROR); assert.equal(doc.payload.code, sc.DECLINE_CODE); assert.equal(doc.payload.retryable, false)
  assert.equal(doc.threadId, p.send[0].id); assert.equal(doc.payload.inResponseTo.id, p.send[0].id)
  assert.ok(!JSON.stringify(doc.payload).includes(inviter.pair.anchor), 'no pairwise identifier in a decline')
  await assert.rejects(() => I.accept(t, 'displayed'), /nothing to accept/)
  // the propose again: the decline goes out again
  const re = await I.receive(p.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(re.send, [doc]); assert.deepEqual(kinds(re), ['ignored'])
  // the responder reads it and sends nothing more; an issue after it is ignored
  const r = await R.receive(doc, inviter.messaging.did, t += 1000)
  assert.deepEqual(r.events, [{ kind: 'declined', message: 'Not now' }]); assert.equal(r.send.length, 0); assert.ok(r.finished && R.declined && !R.complete)
  assert.deepEqual(kinds(await R.receive(doc, inviter.messaging.did, t)), ['ignored'])
  // forgeries: another key, another thread, another recipient, another step, a stray error code
  const other = await sc.partyFromSeeds(await seed('f/msg'), await seed('f/pair'), [MED], 'F')
  const fresh = async () => { const S = await setup(); const pp = await S.R.start(t); await S.I.receive(pp.send[0], S.responder.messaging.did, t); return S }
  const S1 = await fresh(); const forged = await sc.decline({ ...other, messaging: { ...other.messaging, did: S1.inviter.messaging.did } }, S1.R.snapshot().propose, t, 'f1')
  assert.equal((await S1.R.receive(forged, S1.inviter.messaging.did, t)).events[0].reason, 'proof')
  const S2 = await fresh(); const d2 = await sc.decline(S2.inviter, S2.R.snapshot().propose, t, 'f2')
  assert.equal((await S2.R.receive({ ...d2, threadId: 'other' }, S2.inviter.messaging.did, t)).events[0].reason, 'thread')
  assert.equal((await S2.R.receive({ ...d2, recipient: other.messaging.did }, S2.inviter.messaging.did, t)).events[0].reason, 'recipient')
  assert.equal((await S2.R.receive({ ...d2, ceremony: { ...d2.ceremony, step: 'issue-inviter' } }, S2.inviter.messaging.did, t)).events[0].reason, 'proof', 'the step is signed')
  assert.equal((await S2.R.receive({ ...d2, ceremony: { ...d2.ceremony, enactment: await challenge('other-enactment') } }, S2.inviter.messaging.did, t)).events[0].reason, 'enactment')
  assert.equal((await S2.R.receive({ ...d2, payload: { code: 'vrc/relationships/propose:other', retryable: false } }, S2.inviter.messaging.did, t)).events[0].reason, 'proof')
  assert.equal((await S2.R.receive({ ...d2, payload: { ...d2.payload, extra: 1 } }, S2.inviter.messaging.did, t)).events[0].reason, 'payload', 'closed error payload')
  assert.equal((await S2.R.receive({ ...d2, payload: { ...d2.payload, inResponseTo: { id: 'x' } } }, S2.inviter.messaging.did, t)).events[0].reason, 'payload', 'inResponseTo needs typeUri')
  assert.equal((await S2.R.receive({ ...d2, issuedAt: '2030-01-01T00:00:00Z' }, S2.inviter.messaging.did, t)).events[0].reason, 'not-fresh')
  // the registry form: inResponseTo names the propose's type and id, and our own VTI reader reads the document
  assert.deepEqual(d2.payload.inResponseTo, { typeUri: sc.TASK_PROPOSE, id: S2.R.snapshot().propose.id })
  assert.ok(readTrustTaskError(d2) !== null, 'readTrustTaskError reads our decline')
  const long = await sc.decline(S2.inviter, S2.R.snapshot().propose, t, 'f3', 'x'.repeat(1000))
  assert.deepEqual(kinds(await (await fresh()).R.receive(long, S2.inviter.messaging.did, t)), ['declined'], 'a 1,000-character message is within the registry bound')
  // the genuine one still passes afterwards
  assert.deepEqual(kinds(await S2.R.receive(d2, S2.inviter.messaging.did, t)), ['declined'])
})

test('flow: a redelivered propose from another sender gets nothing; a redelivered issue gets its receipt again; a redelivered acceptance the issue again', async () => {
  const { inviter, responder, I, R } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000, 'displayed')
  const other = await sc.partyFromSeeds(await seed('o/msg'), await seed('o/pair'), [MED], 'O')
  // B2 of the review: the same propose relayed by a third party must not fetch the acceptance and the credential
  const relayed = await I.receive(p.send[0], other.messaging.did, t += 1000)
  assert.deepEqual(relayed.events, [{ kind: 'refused', type: sc.TASK_PROPOSE, reason: 'issuer' }]); assert.equal(relayed.send.length, 0)
  const a = await R.receive(acc.send[0], inviter.messaging.did, t += 1000)
  const again = await R.receive(acc.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(again.send, a.send, 'the acceptance again: the issue again')
  const ri = await I.receive(a.send[0], responder.messaging.did, t += 1000)
  const ri2 = await I.receive(a.send[0], responder.messaging.did, t += 1000)
  assert.deepEqual(ri2.send, ri.send, 'the issue again: the receipt again'); assert.deepEqual(kinds(ri2), ['ignored'])
  // same id, other content: nothing goes out
  const forgedIssue = { ...a.send[0], issuedAt: '2026-11-08T15:00:59Z' }
  assert.equal((await I.receive(forgedIssue, responder.messaging.did, t)).send.length, 0)
  // outbox: everything this side made, for a resend after a restart
  assert.deepEqual(I.outbox().map((d) => d.type), [sc.TASK_PROPOSE + '#response', sc.TASK_ISSUE, sc.TASK_ISSUE + '#response'])
  assert.deepEqual(R.outbox().map((d) => d.type), [sc.TASK_PROPOSE, sc.TASK_ISSUE])
  // #182: the other side's receipt arrives before our own receipt left; complete, but our receipt is still owed
  const rr = await I.receive((await R.receive(acc.send[1], inviter.messaging.did, t)).send[0], responder.messaging.did, t)
  assert.deepEqual(kinds(rr), ['receipted', 'complete']); assert.ok(I.complete)
  const I2 = new fl.Inviter(inviter, { id: I.snapshot().id, exp: I.snapshot().exp }, { newId }, I.snapshot())
  assert.deepEqual(I2.outbox(), [I.snapshot().receiptMine], 'after a restart the own receipt goes out again')
})

test('flow: a builder that throws leaves the state as it was; two documents arriving together are handled one after another', async () => {
  const { inviter, responder, read, ch } = await setup()
  let t = T0
  let fail = false
  const flaky = () => { if (fail) throw new Error('no entropy'); return newId() }
  const I = new fl.Inviter(inviter, { id: read.link.id, exp: read.link.exp }, { newId: flaky })
  const R = new fl.Responder(responder, read.link, ch, 'scan', { newId: flaky })
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  fail = true
  await assert.rejects(() => I.accept(t += 1000, 'displayed'), /no entropy/)
  assert.ok(I.pending, 'still pending: the throw changed nothing')
  fail = false
  const acc = await I.accept(t += 1000, 'displayed')
  fail = true
  await assert.rejects(() => R.receive(acc.send[0], inviter.messaging.did, t += 1000), /no entropy/)
  assert.equal(R.snapshot().accept, null, 'the acceptance is not recorded without the issue')
  fail = false
  const a = await R.receive(acc.send[0], inviter.messaging.did, t += 1000)
  assert.deepEqual(kinds(a), ['accepted'])
  // two different proposes at once at a fresh inviter: exactly one is taken
  const S = await setup()
  const other = await sc.partyFromSeeds(await seed('c/msg'), await seed('c/pair'), [MED], 'C')
  const p1 = await sc.propose(S.responder, S.inviter.messaging.did, S.read.link.id, await challenge('c1'), t)
  const p2 = await sc.propose(other, S.inviter.messaging.did, S.read.link.id, await challenge('c2'), t)
  const [x, y] = await Promise.all([S.I.receive(p1, S.responder.messaging.did, t), S.I.receive(p2, other.messaging.did, t)])
  assert.deepEqual([kinds(x), kinds(y)], [['proposed'], ['refused']]); assert.equal(S.I.pending.propose.id, p1.id)
})

test('flow: a restart from the snapshot continues with the same documents', async () => {
  const { inviter, responder, I, R, id, exp, read, ch } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000, 'displayed')
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
  assert.ok(done.finished && I2.complete)
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

test('flow: the other side\'s error that is not a decline ends the enactment as failed, on both sides', async () => {
  const { inviter, responder, I, R } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000, 'displayed')
  const a = await R.receive(acc.send[0], inviter.messaging.did, t += 1000)
  // the inviter refuses the responder's credential with the registry error (as Keyring does: issue notAccepted)
  const err = await sc.signStep(inviter.messaging, { id: 'e1', type: sc.TASK_ERROR, threadId: p.send[0].id, issuer: inviter.messaging.did, recipient: responder.messaging.did, issuedAt: new Date(t).toISOString(), ceremony: { enactment: I.snapshot().id, step: 'issue-responder' }, payload: { code: 'vrc/relationships/issue:notAccepted', retryable: false, message: 'no' } }, new Date(t).toISOString())
  const f = await R.receive(err, inviter.messaging.did, t += 1000)
  assert.deepEqual(f.events, [{ kind: 'failed', code: 'vrc/relationships/issue:notAccepted', step: 'issue-responder', message: 'no' }]); assert.ok(f.finished && R.finished && !R.complete)
  assert.deepEqual(R.failure.code, 'vrc/relationships/issue:notAccepted')
  assert.deepEqual(kinds(await R.receive(err, inviter.messaging.did, t)), ['ignored'])
  assert.deepEqual(kinds(await R.receive(acc.send[1], inviter.messaging.did, t)), ['ignored'], 'an issue after the failure')
  // the responder refuses the inviter's credential: the inviter reads it the same way
  const err2 = await sc.signStep(responder.messaging, { id: 'e2', type: sc.TASK_ERROR, threadId: p.send[0].id, issuer: responder.messaging.did, recipient: inviter.messaging.did, issuedAt: new Date(t).toISOString(), ceremony: { enactment: I.snapshot().id, step: 'issue-inviter' }, payload: { code: 'vrc/relationships/issue:notAccepted', retryable: false } }, new Date(t).toISOString())
  const g = await I.receive(err2, responder.messaging.did, t += 1000)
  assert.equal(g.events[0].kind, 'failed'); assert.ok(I.finished && !I.complete)
  // forged by a third party, or from another thread: refused, not failed
  const other = await sc.partyFromSeeds(await seed('e/msg'), await seed('e/pair'), [MED], 'E')
  const S = await setup(); const pp = await S.R.start(t); await S.I.receive(pp.send[0], S.responder.messaging.did, t)
  const err3 = await sc.signStep(responder.messaging, { ...(({ proof, ...r }) => r)(err2), id: 'e3', threadId: await challenge('another-thread') }, err2.issuedAt)
  assert.equal((await S.I.receive(err3, S.responder.messaging.did, t)).events[0].reason, 'thread')
  assert.equal((await S.I.receive(err2, other.messaging.did, t)).events[0].reason, 'issuer')
  assert.ok(!S.I.finished, 'neither ended the enactment')
})

test('flow: the responder refuses documents from a sender that is not the inviter; held copies, bounds, roles, serialised start', async () => {
  const { inviter, responder, I, R, read, ch } = await setup()
  let t = T0
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000, 'displayed')
  const other = await sc.partyFromSeeds(await seed('z/msg'), await seed('z/pair'), [MED], 'Z')
  for (const d of acc.send) {
    const r = await R.receive(d, other.messaging.did, t)
    assert.deepEqual(r.events, [{ kind: 'refused', type: d.type, reason: 'issuer' }]); assert.equal(r.send.length, 0)
  }
  // the held list: one per id, at most eight, a throwing held document stays held, a decline clears it
  const S = await setup(); const sp = await S.R.start(t); await S.I.receive(sp.send[0], S.responder.messaging.did, t)
  for (let i = 0; i < 10; i++) {
    const r = await S.I.receive({ id: 'h' + i, type: sc.TASK_ISSUE, issuer: S.responder.messaging.did, recipient: S.inviter.messaging.did, issuedAt: new Date(t).toISOString(), threadId: sp.send[0].id, ceremony: { enactment: S.read.link.id, step: 'issue-responder' }, payload: { vrc: {} } }, S.responder.messaging.did, t)
    assert.deepEqual(kinds(r), [i < 8 ? 'held' : 'ignored'])
  }
  assert.equal(S.I.snapshot().held.length, 8)
  const d = await S.I.decline(t)
  assert.equal(S.I.snapshot().held.length, 0); assert.ok(d.finished)
  // held documents that throw in the builders stay held; the acceptance still goes out
  const S2 = await setup(); const sp2 = await S2.R.start(t); await S2.I.receive(sp2.send[0], S2.responder.messaging.did, t)
  let calls = 0
  const flaky = () => { calls++; if (calls === 3) throw new Error('no entropy'); return newId() }
  const I2 = new fl.Inviter(S2.inviter, { id: S2.read.link.id, exp: S2.read.link.exp }, { newId: flaky }, S2.I.snapshot())
  const acc2 = await S2.I.accept(t, 'displayed') // a parallel inviter instance to make the responder's issue
  const a2 = await S2.R.receive(acc2.send[0], S2.inviter.messaging.did, t)
  assert.deepEqual(kinds(await I2.receive(a2.send[0], S2.responder.messaging.did, t)), ['held'])
  const out = await I2.accept(t, 'displayed') // newId calls 1 and 2 build acceptance and issue, call 3 (the receipt for the held issue) throws
  assert.deepEqual(kinds(out), ['accepted']); assert.equal(I2.snapshot().held.length, 1, 'the held issue stays for the next delivery')
  const later = await I2.receive(a2.send[0], S2.responder.messaging.did, t)
  assert.deepEqual(kinds(later), ['credential']); assert.equal(I2.snapshot().held.length, 0)
  // S1 at the inviter: the issue builder throws (second newId), nothing is recorded
  const S3 = await setup(); const sp3 = await S3.R.start(t); let n3 = 0
  const I3 = new fl.Inviter(S3.inviter, { id: S3.read.link.id, exp: S3.read.link.exp }, { newId: () => { if (++n3 === 2) throw new Error('no entropy'); return newId() } })
  await I3.receive(sp3.send[0], S3.responder.messaging.did, t)
  await assert.rejects(() => I3.accept(t, 'displayed'), /no entropy/)
  assert.equal(I3.snapshot().accept, null); assert.ok(I3.pending)
  // roles on restore; start() serialised with receive
  assert.throws(() => new fl.Inviter(inviter, { id: read.link.id, exp: read.link.exp }, { newId }, R.snapshot()), /not an inviter snapshot/)
  assert.throws(() => new fl.Responder(responder, read.link, ch, 'scan', { newId }, I.snapshot()), /not a responder snapshot/)
  const R4 = new fl.Responder(responder, read.link, ch, 'scan', { newId })
  const [st, rec] = await Promise.all([R4.start(t), R4.receive(acc.send[0], inviter.messaging.did, t)])
  assert.equal(st.send.length, 1); assert.notEqual(rec.events[0].reason, 'before-propose', 'start ran before the receive')
  // a decline after the acceptance at the responder is ignored as after-decision
  const dec = await sc.decline(inviter, p.send[0], t, 'late')
  const Rn = await R.receive(acc.send[0], inviter.messaging.did, t)
  assert.ok(Rn.events[0].kind === 'accepted' || Rn.events[0].kind === 'ignored')
  assert.deepEqual(kinds(await R.receive(dec, inviter.messaging.did, t)), ['ignored'])
})

test('flow: a held document that throws stays held at the responder too; an error after complete or a decline is after-decision; failed clears held and empties the outbox', async () => {
  const { inviter, responder, read, ch } = await setup()
  let t = T0
  // responder: the inviter's issue held, the receipt builder throws on the acceptance, the issue stays held
  let calls = 0
  const flaky = () => { calls++; if (calls === 2) throw new Error('no entropy'); return newId() }
  const R = new fl.Responder(responder, read.link, ch, 'scan', { newId: flaky })
  const I = new fl.Inviter(inviter, { id: read.link.id, exp: read.link.exp }, { newId })
  const p = await R.start(t)
  await I.receive(p.send[0], responder.messaging.did, t += 1000)
  const acc = await I.accept(t += 1000, 'displayed')
  assert.deepEqual(kinds(await R.receive(acc.send[1], inviter.messaging.did, t)), ['held'])
  const a = await R.receive(acc.send[0], inviter.messaging.did, t += 1000) // newId 1 for the issue, 2 (the receipt of the held issue) throws
  assert.deepEqual(kinds(a), ['accepted']); assert.equal(R.snapshot().held.length, 1)
  assert.deepEqual(kinds(await R.receive(acc.send[1], inviter.messaging.did, t)), ['credential']); assert.equal(R.snapshot().held.length, 0)
  // an error after complete: after-decision, nothing changes
  const ri = await I.receive(a.send[0], responder.messaging.did, t); await I.receive((await R.receive(acc.send[1], inviter.messaging.did, t)).send[0] ?? R.snapshot().receiptMine, responder.messaging.did, t)
  await R.receive(ri.send[0], inviter.messaging.did, t)
  assert.ok(I.complete && R.complete)
  const late = await sc.signStep(inviter.messaging, { id: 'l1', type: sc.TASK_ERROR, threadId: p.send[0].id, issuer: inviter.messaging.did, recipient: responder.messaging.did, issuedAt: new Date(t).toISOString(), ceremony: { enactment: read.link.id, step: 'issue-responder' }, payload: { code: 'vrc/relationships/issue:notAccepted', retryable: false } }, new Date(t).toISOString())
  assert.deepEqual((await R.receive(late, inviter.messaging.did, t)).events, [{ kind: 'ignored', type: sc.TASK_ERROR, why: 'after-decision' }]); assert.equal(R.failure, null)
  // failed before a decision clears held and empties the outbox; a decline after it is after-decision
  const S = await setup(); const sp = await S.R.start(t); await S.I.receive(sp.send[0], S.responder.messaging.did, t)
  const sacc = await S.I.accept(t, 'displayed')
  const R2 = new fl.Responder(S.responder, S.read.link, S.ch, 'scan', { newId }); await R2.start(t)
  assert.deepEqual(kinds(await R2.receive(sacc.send[1], S.inviter.messaging.did, t)), ['held'])
  const fail = await sc.signStep(S.inviter.messaging, { id: 'f1', type: sc.TASK_ERROR, threadId: sp.send[0].id, issuer: S.inviter.messaging.did, recipient: S.responder.messaging.did, issuedAt: new Date(t).toISOString(), ceremony: { enactment: S.read.link.id, step: 'propose' }, payload: { code: 'vrc/relationships/propose:other', retryable: false } }, new Date(t).toISOString())
  assert.deepEqual(kinds(await R2.receive(fail, S.inviter.messaging.did, t)), ['failed'])
  assert.equal(R2.snapshot().held.length, 0); assert.deepEqual(R2.outbox(), [])
  const dec = await sc.decline(S.inviter, sp.send[0], t, 'd1')
  assert.deepEqual(kinds(await R2.receive(dec, S.inviter.messaging.did, t)), ['ignored']); assert.ok(!R2.declined)
  // an inviter that declined ignores a later error of the responder
  const S3 = await setup(); const sp3 = await S3.R.start(t); await S3.I.receive(sp3.send[0], S3.responder.messaging.did, t); await S3.I.decline(t)
  const e3 = await sc.signStep(S3.responder.messaging, { id: 'e9', type: sc.TASK_ERROR, threadId: sp3.send[0].id, issuer: S3.responder.messaging.did, recipient: S3.inviter.messaging.did, issuedAt: new Date(t).toISOString(), ceremony: { enactment: S3.read.link.id, step: 'propose' }, payload: { code: 'x:y', retryable: false } }, new Date(t).toISOString())
  assert.deepEqual(kinds(await S3.I.receive(e3, S3.responder.messaging.did, t)), ['ignored']); assert.equal(S3.I.failure, null)
  // empty typeUri / id and a non-object details are refused
  const bad = await sc.decline(S3.inviter, sp3.send[0], t, 'd2')
  const R4 = (await setup()).R; await R4.start(t)
  assert.equal((await R4.receive({ ...bad, payload: { ...bad.payload, inResponseTo: { typeUri: '' } } }, S3.inviter.messaging.did, t)).events[0].reason, 'payload')
  assert.equal((await R4.receive({ ...bad, payload: { ...bad.payload, details: 'x' } }, S3.inviter.messaging.did, t)).events[0].reason, 'payload')
})
