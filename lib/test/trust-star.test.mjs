#!/usr/bin/env node
// trust-star (lib Stage 2, PR 4b; Trust 5.1–5.2a, 5.4): star@2 on the
// holder — the root builders against the vectors, the reconciliation
// sweep on resume (view, baseline automaton, salt scope, chunking,
// completion by verified acks) and the reception of star/0.2 (assembly
// per (tuple, salt), repeats, lower salts, the resource limit, the
// accepted snapshot tested against every held anchor).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as C from '../dist/index.js'
import { starKeyOf, buildStarChunks } from '../dist/star.js'

const vec = (f) => JSON.parse(readFileSync(new URL('../../vectors/' + f, import.meta.url), 'utf8'))
const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))

test('star: the root builder reproduces the star of vectors/visibility.json byte for byte', async () => {
  const V = vec('visibility.json')
  const IKM = hex(vec('identity-derivation.json').rootIkm)
  const A = await C.pairContext(IKM, hex(V.parties.A.relationshipNonce))
  const shared = await C.ecdh(A.x.priv, C.xRawOfMk(V.parties.B.keyAgreement))
  const k = await starKeyOf(shared, V.parties.A.anchor, V.parties.B.anchor, '1')
  const chunks = await buildStarChunks(k, '1', [V.starContact.anchor])
  assert.equal(chunks.length, 1)
  assert.equal(C.jcs(chunks[0]), C.jcs(V.artifacts.star))
})

// ── the holder (PR 4b) ─────────────────────────────────────────────────

import { createEngine, trustModule } from '../dist/internal.js'
import { createHolder as mkHolder } from '../dist/index.js'
import { macU } from '../dist/anchor.js'
import { T0 } from './pair-fixture.mjs'
import { STAR, GSTAR, MAPPING, ACK, tid, person, network, router, state, tupleOf, edit, starDoc, openAt, standIns } from './star-fixture.mjs'

const trust = (p, contactId, when = T0) => p.holder.act('trust.set', { contactId, on: true }, when, { actId: `${p.name}-trusts-${contactId}` })
const ofType = (out, type) => out.filter((o) => o.type === type)
const MAX = '999999999999999999'

test('star: A holds B and C; B and C give A their mappings — A\'s star to B blinds C, and B matches C against the anchor it holds for C (5010, 6160)', async () => {
  const A = await person('A', 0x11), B = await person('B', 0x12), C = await person('C', 0x13)
  const net = await network([A, B, C], [[A, B], [A, C], [B, C]])
  await trust(B, 'A'); await trust(C, 'A'); await trust(C, 'B')
  const log = await net.pump(T0 + 1)
  const sA = await state(A)
  assert.deepEqual(sA.contacts.B.status, 'admitted')
  const outB = tupleOf(sA, 'r-B').starOut
  assert.deepEqual(outB.snapshot, [{ member: 'B', head: B.self }, { member: 'C', head: C.self }], 'the baseline is the view sent and acknowledged (5630)')
  assert.equal(outB.hwm, outB.lastSalt)
  assert.deepEqual(outB.inflight, {})
  const inB = tupleOf(await state(B), 'r-A').starIn
  assert.deepEqual(inB.accepted.matches, ['C'], 'B holds C\'s anchor; A\'s star carries it')
  assert.equal(inB.accepted.blinded.length, 2, 'the whole union is kept (B and C)')
  assert.equal(inB.hwm, outB.hwm)
  assert.equal(inB.assembly, null)
  // the completing chunk announced it, once per completed salt
  const accepted = log.filter((x) => x.to === 'B' && x.type === STAR && x.r.disposition === 'unique').flatMap((x) => x.r.events).filter((e) => e.type === 'star.accepted' && e.contactId === 'A')
  assert.ok(accepted.length >= 1)
  assert.equal(accepted.at(-1).salt, inB.hwm)
  // no raw third-party anchor travels (5020): the star documents carry only MAC values
  for (const x of log.filter((y) => y.type === STAR)) {
    const doc = JSON.stringify(x.r)
    assert.ok(!doc.includes(C.self) && !doc.includes(B.self))
  }
})

test('star: more than 1024 entries — sorted once, sliced into chunks of ≤ 1024 within 65 536 bytes, one salt, one thread; assembled out of order; complete only when every chunk is acked', async () => {
  const A = await person('A', 0x21), B = await person('B', 0x22)
  const net = await network([A, B], [[A, B]], { build: { A: (b) => standIns(b, 1100) } })
  const r = await A.holder.resume(T0)
  const stars = ofType(r.outbound, STAR)
  assert.equal(stars.length, 2)
  const docs = await Promise.all(stars.map((o) => openAt(B, A, o.envelope)))
  for (const d of docs) assert.ok(new TextEncoder().encode(JSON.stringify(d)).length <= 65536, 'within the plaintext limit (5190)')
  assert.deepEqual(docs.map((d) => [d.payload.body.salt, d.payload.body.seq, d.payload.body.last, d.payload.body.blinded.length]), [['1', '1', false, 1024], ['1', '2', true, 76]])
  assert.equal(new Set(docs.map((d) => d.threadId)).size, 1, 'one salt, one thread (Delivery §4.4)')
  const union = docs.flatMap((d) => d.payload.body.blinded)
  assert.ok(union.every((x, i) => i === 0 || union[i - 1] < x), 'the union sorted once, sliced in order (5220)')
  const sA = await state(A)
  assert.equal(tupleOf(sA, 'r-B').starOut.lastSalt, '1', 'the salt is persisted with the outbox items, before anything is sent (5090)')
  assert.deepEqual(tupleOf(sA, 'r-B').starOut.inflight['1'].digests, stars.map((o) => o.digest))
  // B: chunk 2 first, then 1 — every chunk acked, only the completing one announces
  const r2 = await B.holder.receive(stars[1].envelope, T0 + 1)
  assert.equal(r2.disposition, 'unique')
  assert.deepEqual(ofType(r2.outbound, ACK).length, 1)
  assert.deepEqual(r2.events, [])
  assert.equal(tupleOf(await state(B), 'r-A').starIn.assembly.salt, '1')
  const r1 = await B.holder.receive(stars[0].envelope, T0 + 1)
  assert.deepEqual(r1.events.map((e) => [e.type, e.contactId, e.salt]), [['star.accepted', 'A', '1']])
  const inB = tupleOf(await state(B), 'r-A').starIn
  assert.deepEqual([inB.hwm, inB.assembly, inB.accepted.matches], ['1', null, []])
  // A: the ack of chunk 2 alone completes nothing; an adapter report neither
  await A.holder.report({ digest: stars[0].digest, status: 'delivered', late: false }, T0 + 2)
  await net.deliver(r2.outbound, T0 + 2)
  let out = tupleOf(await state(A), 'r-B').starOut
  assert.deepEqual([out.hwm, out.snapshot, out.inflight['1'].acked], ['0', null, [stars[1].digest]])
  await net.deliver(r1.outbound, T0 + 3)
  out = tupleOf(await state(A), 'r-B').starOut
  assert.equal(out.hwm, '1')
  assert.equal(out.snapshot.length, 1100)
  assert.deepEqual(out.inflight, {})
  assert.deepEqual(ofType((await A.holder.resume(T0 + 4)).outbound, STAR), [], 'converged: nothing to deliver (5720)')
})

test('star: a restart after the production commit — resume re-offers the chunks byte-identical, threadId included; no new salt while the view is in flight', async () => {
  const A = await person('A', 0x31), B = await person('B', 0x32)
  await network([A, B], [[A, B]])
  const first = ofType((await A.holder.resume(T0)).outbound, STAR)
  assert.equal(first.length, 1)
  const h2 = await mkHolder({ store: A.store, keys: A.keys })        // the restart: the outbound was never sent
  assert.deepEqual((await h2.resume(T0 + 1)).outbound, [], 'not due, and no new salt for the same view')
  const due = (await state(A)).outbox[first[0].digest].nextAttemptAt
  const again = ofType((await h2.resume(due)).outbound, STAR)
  assert.deepEqual(again.map((o) => [o.digest, o.attempt, C.jcs(o.envelope), o.threadId]), [[first[0].digest, 2, C.jcs(first[0].envelope), first[0].threadId]])
  assert.equal((await openAt(B, A, again[0].envelope)).threadId, first[0].threadId)
  assert.equal(tupleOf(await state(A), 'r-B').starOut.lastSalt, '1')
})

test('star: the baseline automaton — a later completion of a lower salt changes nothing (5670, no rollback); a failed delivery leaves the divergence for a fresh salt (5680)', async () => {
  const A = await person('A', 0x41), B = await person('B', 0x42)
  const net = await network([A, B], [[A, B]])
  const s1 = ofType((await A.holder.resume(T0)).outbound, STAR)
  // a new member x, admitted (its own relationship, star off toward it)
  await edit(A, (s) => {
    s.contacts.x = { id: 'x', pos: s.entryOrder.nextPos, status: 'admitted', aliases: [], relIds: ['r-x'], anchorHead: 'did:key:zHeadX', settings: { star: 'off', groupStar: 'off', anchorMapping: 'default', sealedGroupStar: 'default', profile: 'default' }, groupSettings: {} }
    s.entryOrder.nextPos = String(BigInt(s.entryOrder.nextPos) + 1n)
    const t = structuredClone(s.relationships['r-B'].tuples[0])
    s.relationships['r-x'] = { ...structuredClone(s.relationships['r-B']), id: 'r-x', contactId: 'x', tuples: [{ ...t, ownPairLabel: 'pair/x', rkid: 'z6LSownx', counterpartAnchor: 'did:key:zx', counterpartKeyAgreement: 'z6LSx', entryId: 'x' }], activeHead: 'pair/x' }
    s.register.labels.push('pair/x')
  })
  const s2 = ofType((await A.holder.resume(T0 + 1)).outbound, STAR)
  assert.equal((await openAt(B, A, s2[0].envelope)).payload.body.salt, '2', 'the changed view goes out under the next salt while salt 1 is in flight')
  // B takes salt 1, then 2; the acks reach A in the other order
  const a1 = (await B.holder.receive(s1[0].envelope, T0 + 2)).outbound
  const a2 = (await B.holder.receive(s2[0].envelope, T0 + 2)).outbound
  await net.deliver(a2, T0 + 3)
  let out = tupleOf(await state(A), 'r-B').starOut
  assert.deepEqual([out.hwm, out.snapshot, Object.keys(out.inflight)], ['2', [{ member: 'x', head: 'did:key:zHeadX' }], []])
  await net.deliver(a1, T0 + 4)
  out = tupleOf(await state(A), 'r-B').starOut
  assert.deepEqual([out.hwm, out.snapshot], ['2', [{ member: 'x', head: 'did:key:zHeadX' }]], 's ≤ H: unchanged')
  // a delivery given up (the adapter's verdict) leaves the divergence: the next resume issues a fresh salt
  await edit(A, (s) => { s.contacts.x.anchorHead = 'did:key:zHeadX2' })
  const s3 = ofType((await A.holder.resume(T0 + 5)).outbound, STAR)
  assert.equal(s3.length, 1)
  assert.deepEqual(ofType((await A.holder.resume(T0 + 6)).outbound, STAR), [], 'in flight: no second salt')
  await A.holder.report({ digest: s3[0].digest, status: 'failed', reason: 'unroutable' }, T0 + 7)
  const s4 = ofType((await A.holder.resume(T0 + 8)).outbound, STAR)
  assert.equal((await openAt(B, A, s4[0].envelope)).payload.body.salt, '4', 'consumed salts stay consumed (5130)')
})

test('star: the class off suppresses production and keeps the baseline (5830); turning it on again cues resume and delivers the divergence that stood (5850)', async () => {
  const A = await person('A', 0x51), B = await person('B', 0x52)
  const net = await network([A, B], [[A, B]], { build: { A: (b) => standIns(b, 1) } })
  await net.pump(T0)
  const base = tupleOf(await state(A), 'r-B').starOut
  assert.equal(base.hwm, '1')
  const p = await A.holder.act('trust.pause', { contactId: 'B', paused: true }, T0 + 1, { actId: 'p1' })
  assert.equal(p.ok, true)
  await edit(A, (s) => { s.contacts.x00000.anchorHead = 'did:key:zMoved' })
  assert.deepEqual((await A.holder.resume(T0 + 2)).outbound, [], 'nothing, not even filler')
  assert.deepEqual(tupleOf(await state(A), 'r-B').starOut, base, 'the baseline as it was')
  const on = await A.holder.act('trust.pause', { contactId: 'B', paused: false }, T0 + 3, { actId: 'p2' })
  assert.equal(on.nextDueAt, T0 + 3, 'the divergence that stood is owed again: the cue to resume')
  const r = ofType((await A.holder.resume(T0 + 4)).outbound, STAR)
  const body = (await openAt(B, A, r[0].envelope)).payload.body
  assert.equal(body.salt, '2')
  assert.equal(body.blinded.length, 1)
})

test('star: the scope issues its maximum once and nothing after it (2600, 5700)', async () => {
  const A = await person('A', 0x61), B = await person('B', 0x62)
  await network([A, B], [[A, B]], { build: { A: (b) => b.with((s) => { s.relationships['r-B'].tuples[0].starOut.lastSalt = String(BigInt(MAX) - 1n) }) } })
  const r = ofType((await A.holder.resume(T0)).outbound, STAR)
  assert.equal((await openAt(B, A, r[0].envelope)).payload.body.salt, MAX)
  const out = tupleOf(await state(A), 'r-B').starOut
  assert.deepEqual([out.lastSalt, out.exhausted], [MAX, true])
  await A.holder.report({ digest: r[0].digest, status: 'failed', reason: 'unroutable' }, T0 + 1)
  assert.deepEqual(ofType((await A.holder.resume(T0 + 2)).outbound, STAR), [], 'exhausted: the duty is suspended (2610)')
})

// ── reception ──────────────────────────────────────────────────────────

const pairAB = async (fillA, fillB, opts) => {
  const A = await person('A', fillA), B = await person('B', fillB)
  const net = await network([A, B], [[A, B]], opts)
  return { A, B, net }
}
const failedAt = (r) => [r.disposition, r.stage, r.ref]

test('star reception: a byte-identical repeat is duplicate-known; the same seq in other bytes is refused, nothing commits, the assembly stays (5250, 5260)', async () => {
  const { A, B } = await pairAB(0x71, 0x72)
  const c1 = await starDoc(A, B, { salt: '3', seq: '1', last: false, blinded: [] })
  const r1 = await B.holder.receive(c1.envelope, T0)
  assert.equal(r1.disposition, 'unique')
  assert.equal((await B.holder.receive(c1.envelope, T0)).disposition, 'duplicate-known')
  const other = await starDoc(A, B, { salt: '3', seq: '1', last: false, blinded: [] })
  const before = await state(B)
  assert.deepEqual(failedAt(await B.holder.receive(other.envelope, T0)), ['failed', 8, 'RLTP-TRU-5260'])
  assert.equal((await state(B)).commitSeq, before.commitSeq, 'nothing commits')
  assert.equal(Object.hasOwn((await state(B)).effects, other.digest), false, 'not acknowledged')
  const inB = tupleOf(await state(B), 'r-A').starIn
  assert.deepEqual([Object.keys(inB.assembly.chunks), inB.lowerBound, inB.hwm], [['1'], '0', '0'], 'the assembly as it was')
  const c2 = await starDoc(A, B, { salt: '3', seq: '2', last: true, blinded: [] })
  const r2 = await B.holder.receive(c2.envelope, T0)
  assert.deepEqual(r2.events.map((e) => [e.type, e.salt]), [['star.accepted', '3']], 'completed from the original chunks')
})

test('star reception: one open assembly per tuple — a higher salt displaces it, a lower one is rejected, a completed salt is never accepted again (5330, 5340, 5150)', async () => {
  const { A, B } = await pairAB(0x73, 0x74)
  assert.equal((await B.holder.receive((await starDoc(A, B, { salt: '2', seq: '1', last: false })).envelope, T0)).disposition, 'unique')
  assert.equal((await B.holder.receive((await starDoc(A, B, { salt: '5', seq: '1', last: false, threadId: tid('t-5') })).envelope, T0)).disposition, 'unique')
  assert.equal(tupleOf(await state(B), 'r-A').starIn.assembly.salt, '5')
  assert.deepEqual(failedAt(await B.holder.receive((await starDoc(A, B, { salt: '2', seq: '2', last: true })).envelope, T0)), ['failed', 8, 'RLTP-TRU-5340'])
  const done = await B.holder.receive((await starDoc(A, B, { salt: '5', seq: '2', last: true, threadId: tid('t-5') })).envelope, T0)
  assert.deepEqual(done.events.map((e) => [e.type, e.salt]), [['star.accepted', '5']])
  assert.deepEqual(failedAt(await B.holder.receive((await starDoc(A, B, { salt: '5', seq: '1', last: true, threadId: tid('t-x') })).envelope, T0)), ['failed', 8, 'RLTP-TRU-5150'])
  assert.deepEqual(failedAt(await B.holder.receive((await starDoc(A, B, { salt: '4' })).envelope, T0)), ['failed', 8, 'RLTP-TRU-5150'])
})

test('star reception: another thread, a second last, a seq beyond last, an unsorted union and a wrong MAC are refused, nothing committed (5280, 5270, 5290, 5300, 5080)', async () => {
  const { A, B } = await pairAB(0x75, 0x76)
  const recv = async (o) => B.holder.receive((await starDoc(A, B, o)).envelope, T0)
  await recv({ salt: '1', seq: '1', last: false })
  assert.deepEqual(failedAt(await recv({ salt: '1', seq: '2', last: true, threadId: tid('other') })), ['failed', 8, 'RLTP-TRU-5280'])
  await recv({ salt: '2', seq: '2', last: true, threadId: tid('t2') })
  assert.deepEqual(failedAt(await recv({ salt: '2', seq: '3', last: true, threadId: tid('t2') })), ['failed', 8, 'RLTP-TRU-5270'])
  await recv({ salt: '3', seq: '2', last: true, threadId: tid('t3') })
  assert.deepEqual(failedAt(await recv({ salt: '3', seq: '4', last: false, threadId: tid('t3') })), ['failed', 8, 'RLTP-TRU-5290'])
  const k4 = (await starDoc(A, B, { salt: '4' })).k
  const [lo, hi] = [await macU(k4, 'a'), await macU(k4, 'b')].sort()
  await recv({ salt: '4', seq: '1', last: false, blinded: [hi], threadId: tid('t4') })
  assert.deepEqual(failedAt(await recv({ salt: '4', seq: '2', last: true, blinded: [lo], threadId: tid('t4') })), ['failed', 8, 'RLTP-TRU-5300'])
  const inB = tupleOf(await state(B), 'r-A').starIn
  assert.deepEqual([inB.assembly.salt, Object.keys(inB.assembly.chunks), inB.lowerBound, inB.hwm], ['4', ['1'], '0', '0'])
  const bad = await starDoc(A, B, { salt: '9', mac: 'u' + 'A'.repeat(43) })
  assert.deepEqual(failedAt(await B.holder.receive(bad.envelope, T0)), ['failed', 8, 'RLTP-TRU-5080'])
})

test('star reception: an assembly reaching the resource limit is discarded; the salt is held as the lower bound and no later chunk of it is acked (5365, 5366)', async () => {
  const { A, B } = await pairAB(0x77, 0x78, {
    holder: { B: (p) => createEngine({ store: p.store, keys: p.keys }, [trustModule({ assemblyLimit: 2 })]) },
  })
  assert.equal((await B.holder.receive((await starDoc(A, B, { salt: '7', seq: '1', last: false })).envelope, T0)).disposition, 'unique')
  const overDoc = await starDoc(A, B, { salt: '7', seq: '3', last: true })
  const over = await B.holder.receive(overDoc.envelope, T0)
  assert.deepEqual(over, { disposition: 'discarded', digest: overDoc.digest, type: STAR, ref: 'RLTP-TRU-5365' })
  assert.equal(Object.hasOwn((await state(B)).effects, overDoc.digest), false, 'no cache entry, no ack')
  const inB = tupleOf(await state(B), 'r-A').starIn
  assert.deepEqual([inB.assembly, inB.lowerBound], [null, '7'])
  assert.deepEqual(failedAt(await B.holder.receive((await starDoc(A, B, { salt: '7', seq: '2', last: true })).envelope, T0)), ['failed', 8, 'RLTP-TRU-5366'])
  assert.equal((await B.holder.receive((await starDoc(A, B, { salt: '8' })).envelope, T0)).disposition, 'unique', 'a higher salt is taken')
})

test('star reception: a deactivated tuple takes no chunk (5360)', async () => {
  const { A, B } = await pairAB(0x79, 0x7a)
  await edit(B, (s) => { s.relationships['r-A'].tuples[0].deactivated = true })
  assert.deepEqual(failedAt(await B.holder.receive((await starDoc(A, B)).envelope, T0)), ['failed', 8, 'RLTP-TRU-5360'])
})

test('star reception: tested against every anchor held for a contact — a sender that still blinds the generation before a rotation matches (6160, 6390)', async () => {
  const A = await person('A', 0x81), B = await person('B', 0x82), C = await person('C', 0x83)
  const C1 = 'did:key:z6MkhPjg5MgkyGp2WTuWe8cA1nWczN1strK8AcUSVCZpPEnN'
  const C2 = 'did:key:z6MknXvHPd2AimwxPVcptemsQL1eNeizHcujQR4Q3bNkVda7'
  await network([A, B, C], [[A, B], [B, C]], {
    build: {
      B: (b) => b.entry('C').contact('C', { anchorHead: C2 }).with((s) => {
        Object.assign(s.relationships['r-C'], { heldCounterpartHead: C2, links: [{ prev: C1, next: C2 }] })
      }),
    },
  })
  const r = await B.holder.receive((await starDoc(A, B, { anchors: [C1, 'did:key:zSomeoneElse'] })).envelope, T0)
  assert.deepEqual(r.events.map((e) => [e.type, e.contactId]), [['star.accepted', 'A']])
  const acc = tupleOf(await state(B), 'r-A').starIn.accepted
  assert.deepEqual(acc.matches, ['C'])
  assert.equal(acc.blinded.length, 2, 'the unknown entry is kept for a later re-match')
})

test('star: a class-on duty of a star class is discharged by the reconciliation in the same resume (2850, 5850); the profile\'s waits for its module', async () => {
  const A = await person('A', 0x91), B = await person('B', 0x92)
  await network([A, B], [[A, B]], {
    build: {
      A: (b) => b
        .duty({ kind: 'class-on', v: 1, id: 'on-star', contactId: 'B', relId: 'r-B', cls: 'star' })
        .duty({ kind: 'class-on', v: 1, id: 'on-sealed', contactId: 'B', relId: 'r-B', cls: 'sealedGroupStar' })
        .duty({ kind: 'class-on', v: 1, id: 'on-profile', contactId: 'B', relId: 'r-B', cls: 'profile' }),
    },
  })
  const r = await A.holder.resume(T0)
  assert.equal(ofType(r.outbound, STAR).length, 1)
  assert.equal(ofType(r.outbound, GSTAR).length, 1)
  assert.deepEqual(Object.keys((await state(A)).duties), ['on-profile'])
})

test('star: a delivery given up at the horizon inside a resume cues the next one at once (nextDueAt = when), which issues the next salt', async () => {
  const A = await person('A', 0xe1), B = await person('B', 0xe2)
  await network([A, B], [[A, B]])
  const first = ofType((await A.holder.resume(T0)).outbound, STAR)
  const horizon = T0 + 7 * 86_400_000
  const gave = await A.holder.resume(horizon)
  assert.ok(gave.events.some((e) => e.type === 'delivery.status' && e.digest === first[0].digest && e.status === 'failed'))
  assert.deepEqual(ofType(gave.outbound, STAR), [], 'prepared before the give-up: nothing issued in this resume')
  assert.equal(gave.nextDueAt, horizon, 'the divergence stands again: due at once')
  const next = ofType((await A.holder.resume(horizon)).outbound, STAR)
  assert.equal((await openAt(B, A, next[0].envelope)).payload.body.salt, '2')
})

test('star: a divergence a duty creates in the same resume is due at once and goes out on the next resume', async () => {
  const moveModule = {
    name: 'move',
    commands: { 'move.queue': { human: false, apply: (s) => ({ state: s, duties: [{ kind: 'move-head', v: 1, id: 'mv' }] }) } },
    duties: { 'move-head': { v: 1, apply: (s) => ({ state: { ...s, contacts: { ...s.contacts, x00000: { ...s.contacts.x00000, anchorHead: 'did:key:zMovedByDuty' } } } }) } },
  }
  const A = await person('A', 0xe3), B = await person('B', 0xe4)
  const net = await network([A, B], [[A, B]], {
    build: { A: (b) => standIns(b, 1) },
    holder: { A: (p) => mkHolder({ store: p.store, keys: p.keys }, { modules: [moveModule] }) },
  })
  await net.pump(T0)
  assert.equal(tupleOf(await state(A), 'r-B').starOut.hwm, '1')
  await A.holder.act('move.queue', null, T0 + 1)
  const r = await A.holder.resume(T0 + 2)
  assert.deepEqual(ofType(r.outbound, STAR), [], 'the sweep was prepared before the duty ran')
  assert.equal(r.nextDueAt, T0 + 2)
  const next = ofType((await A.holder.resume(T0 + 2)).outbound, STAR)
  assert.equal((await openAt(B, A, next[0].envelope)).payload.body.salt, '2')
})

test('star reception: a star that blinds an anchor the holder learns only later — after the mapping that makes it held, the match appears (6160, 6390)', async () => {
  const { communityContext } = await import('../dist/index.js')
  const { makeAnchorRotation } = await import('../dist/anchor.js')
  const { craftMapping, mappingEnvelope } = await import('./pair-fixture.mjs')
  const A = await person('A', 0xf1), B = await person('B', 0xf2), C = await person('C', 0xf3)
  await network([A, B, C], [[A, B], [B, C]])
  const cSide = { ...C.pairs.B, seed: C.seed, genesis: C.genesis, head: 1 }
  const bSide = B.pairs.C
  // B holds C's generation 1
  assert.equal((await B.holder.receive((await mappingEnvelope(cSide, bSide, await craftMapping(cSide, bSide, { revision: '1', gen: 1 }))).envelope, T0)).disposition, 'unique')
  // C rotates; A already blinds C's generation 2 in its star to B
  const g = await Promise.all([1, 2, 3].map((n) => communityContext(C.seed, C.genesis, n)))
  const C2 = g[1].anchor
  const r = await B.holder.receive((await starDoc(A, B, { anchors: [C2, 'did:key:zSomeoneElse'] })).envelope, T0 + 1)
  assert.equal(r.disposition, 'unique')
  assert.deepEqual(tupleOf(await state(B), 'r-A').starIn.accepted.matches, [], 'B holds only generation 1')
  // B verifies C's rotation: C2 is held now, the stored star matches C
  const r12 = await makeAnchorRotation(g[0], g[1], g[2])
  const m2 = await craftMapping(cSide, bSide, { revision: '2', gen: 2, lineage: [r12] })
  assert.equal((await B.holder.receive((await mappingEnvelope(cSide, bSide, m2)).envelope, T0 + 2)).disposition, 'unique')
  const sB = await state(B)
  assert.equal(sB.relationships['r-C'].heldCounterpartHead, C2)
  assert.deepEqual(tupleOf(sB, 'r-A').starIn.accepted.matches, ['C'])
})

test('star: in-flight entries that can no longer complete are pruned — at the next production and by tick; repeated failed deliveries keep the state bounded', async () => {
  const A = await person('A', 0xf5), B = await person('B', 0xf6)
  await network([A, B], [[A, B]], { build: { A: (b) => standIns(b, 1) } })
  let when = T0
  for (let i = 0; i < 5; i++) {
    await edit(A, (s) => { s.contacts.x00000.anchorHead = 'did:key:zHead' + i })
    const out = (await A.holder.resume(when)).outbound.filter((o) => o.type === STAR || o.type === GSTAR)
    for (const o of out) await A.holder.report({ digest: o.digest, status: 'failed', reason: 'unroutable' }, when + 1)
    when += 10
  }
  let t = tupleOf(await state(A), 'r-B')
  assert.equal(t.starOut.lastSalt, '5')
  assert.deepEqual(Object.keys(t.starOut.inflight), ['5'], 'each production pruned the failed ones before it')
  assert.ok(Object.keys(t.groupStarOut.inflight).length <= 1)
  await A.holder.tick(when + 400 * 86_400_000)
  t = tupleOf(await state(A), 'r-B')
  assert.deepEqual([t.starOut.inflight, t.groupStarOut.inflight], [{}, {}], 'tick prunes what cannot complete')
  assert.equal(t.starOut.lastSalt, '5', 'consumed salts stay consumed')
})

test('star: views compare by digest — pending over a 400-contact steady state is cheap and keys name the view digest', async () => {
  const { sha256Hex, starView, viewDigest, trustModule: tm } = await import('../dist/internal.js')
  const { stateBuilder } = await import('../dist/testing.js')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('a'.repeat(1000)), '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  const b = standIns(stateBuilder(), 400)
  for (let i = 0; i < 400; i++) b.settings(`x${String(i).padStart(5, '0')}`, { star: 'on', groupStar: 'on' })
  const s = b.build()
  const view = starView(s)
  const d = viewDigest(view), g = viewDigest([])
  for (const rel of Object.values(s.relationships)) {
    const t = rel.tuples[0]
    t.starOut = { ...t.starOut, lastSalt: '1', hwm: '1', snapshot: view, snapshotDigest: d }
    t.groupStarOut = { ...t.groupStarOut, lastSalt: '1', hwm: '1', snapshot: [], snapshotDigest: g }
  }
  const { sweeps } = tm()
  const t0 = performance.now()
  assert.deepEqual(sweeps['trust.star'].pending(s, T0), [])
  assert.deepEqual(sweeps['trust.groupStar'].pending(s, T0), [])
  assert.ok(performance.now() - t0 < 500, 'steady state: digests compared, views not re-serialized per recipient')
  s.relationships['r-x00007'].tuples[0].starOut.snapshotDigest = 'stale'
  assert.deepEqual(sweeps['trust.star'].pending(s, T0), [`star|r-x00007|pair/x00007|${d}`])
})
