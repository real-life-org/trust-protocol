#!/usr/bin/env node
// encounter-ported (lib Stage 2, PR 7b): the regressions of the probe's
// encounter suite (the deleted test/encounter.test.mjs: negatives and
// reviews 1–25) ported onto the holder (createHolder, encounter/ceremony.ts).
// What encounter-holder.test.mjs already pins is not repeated here.
//
// The probe's lock and perturbation hooks become the engine's model: every
// act and receive of one holder runs in one queue, and another writer is
// another holder over the same store — a Store wrapper runs it between
// preparation and commit, the CAS conflicts and the operation re-runs on
// the new state. The probe's injected ids and nonces become the Entropy
// port (a steerable entropy below); a restart is a second createHolder
// over the same store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  createHolder, labeledContext, diSign, seal, unseal, jcs, cardBody, binding, CEREMONY, iso, issueCredential, signCard,
  base58, fromB64u, randomEntropy, challengeOf,
} from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { resolveChallenge } from '../dist/internal.js'
import { T0, BUNDLE, DELIVERY, ACK, person, ev, opts, scanned, settle, met, communityPerson } from './holder-fixture.mjs'

const M = 60_000, H = 3_600_000

// ── helpers ────────────────────────────────────────────────────────────

/** Randomness with values forced per purpose, in order; unchecked, so a
 *  forced value of the wrong length reaches its consumer. */
function steerable () {
  const base = randomEntropy()
  const q = new Map()
  return {
    force (purpose, ...values) { q.set(purpose, [...(q.get(purpose) ?? []), ...values]) },
    bytes (purpose, n) { const l = q.get(purpose); return l?.length ? l.shift() : base.bytes(purpose, n) },
    id (purpose) { const l = q.get(purpose); return l?.length ? l.shift() : base.id(purpose) },
  }
}

/** A Store over `inner` that runs `hook` (once per arming) before a commit
 *  reaches it: another writer moves the state between preparation and commit. */
function hookedStore (inner = new InMemoryStore()) {
  const w = {
    inner, hook: null, commits: 0,
    read: () => inner.read(),
    async commit (v, s) {
      w.commits++
      if (w.hook) { const h = w.hook; w.hook = null; await h() }
      return inner.commit(v, s)
    },
  }
  return w
}

/** Edit a store's state directly (another writer outside any holder). */
async function edit (store, fn) {
  const { state, version } = await store.read()
  const s = structuredClone(state)
  fn(s)
  const r = await store.commit(version, s)
  if (!r.ok) throw new Error('edit: conflict')
}

/** The holder over a person's store again (a restart); invariants off where
 *  a test deactivates a tuple by hand. */
const restart = (P, { invariants = true } = {}) => createHolder({ store: P.store, keys: P.keys }, { invariants })

const records = async (P) => Object.values((await P.read()).encounter.records)
const seqOf = async (P) => (await P.read()).commitSeq
const failed = (r) => [r.disposition, r.reason, r.stage, r.ref]
const shownCard = async (P, t, name) => ev(await P.h.show(opts(t, name === undefined ? {} : { name })), 'encounter.shown')[0].card
const labelOfKey = async (P, rkid) => (await P.read()).addresses.keys[rkid].label

/** Open an envelope sealed to an own key of P. */
async function openAt (P, env) {
  const ctx = await labeledContext(P.seed, await labelOfKey(P, env.rkid))
  const r = await unseal(env, ctx.x.priv)
  if (r.error) throw new Error('openAt: ' + r.error)
  return r.document
}

/** The pair context of P's record (scanner: its sent card's anchor; displayer: the displayed one). */
const ctxOfRecord = (P, rec) => labeledContext(P.seed, rec.label)

/** A credential delivery from the displayer D (its record dRec) to the scanner. */
async function deliveryFrom (D, dRec, { credential, threadId, ceremony, when = T0 + 3000 } = {}) {
  const ctx = await ctxOfRecord(D, dRec)
  const cred = credential ?? await issueCredential(ctx, dRec.counterpart, CEREMONY, dRec.peer, dRec.bind, iso(when))
  const doc = {
    id: randomUUID(), type: DELIVERY, issuer: ctx.anchor, recipient: dRec.counterpart, threadId: threadId ?? dRec.thread,
    issuedAt: iso(when), payload: { credential: cred }, ...(ceremony !== undefined ? { ceremony } : {}),
  }
  return seal(doc, dRec.card.keyAgreement)
}

/** A, B with B holding the bundle: both records. */
async function bundled (A, B, t = T0) {
  const s = await scanned(A, B, t)
  const got = await B.h.receive(s.bundle.envelope, t + 2000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  const [recA] = await records(A), [recB] = await records(B)
  return { ...s, got, recA, recB }
}

const isAck = (r) => r.disposition === 'unique' && r.outbound[0]?.type === ACK
const flip = (z) => z.slice(0, -1) + (z.at(-1) === '1' ? '2' : '1')

// ── negatives ──────────────────────────────────────────────────────────

test('encounter (ported: negatives): a bundle whose ceremony.enactment does not recompute; a wrong recipient before a malformed payload; a malformed payload alone — each fails at its stage, nothing commits, the challenge stays open', async () => {
  const A = await person(0x70), B = await person(0x71)
  const { card, bundle } = await scanned(A, B)
  const doc = await openAt(B, bundle.envelope)
  const seq = await seqOf(B)
  const lie = { ...doc, id: randomUUID(), ceremony: { enactment: await binding(CEREMONY, 'x'.repeat(22), 'y'.repeat(22)) } }
  assert.deepEqual(failed(await B.h.receive(await seal(lie, card.keyAgreement), T0 + 2000)), ['failed', 'validation-failed', 8, undefined])
  const wrongRec = { ...doc, id: randomUUID(), recipient: doc.issuer, payload: {} }
  assert.deepEqual(failed(await B.h.receive(await seal(wrongRec, card.keyAgreement), T0 + 2000)), ['failed', 'wrong-recipient', 5, undefined])
  const junk = { ...doc, id: randomUUID(), payload: {} }
  assert.deepEqual(failed(await B.h.receive(await seal(junk, card.keyAgreement), T0 + 2000)), ['failed', 'malformed', 7, undefined])
  const s = await B.read()
  assert.equal(s.commitSeq, seq, 'nothing committed')
  assert.equal(resolveChallenge(s, card.challenge.value, T0 + 2000), 'open')
  assert.deepEqual(s.encounter.records, {})
  // the genuine bundle still lands
  assert.equal((await B.h.receive(bundle.envelope, T0 + 2100)).disposition, 'unique')
})

// ── review 1 ───────────────────────────────────────────────────────────

test('encounter (ported from review 1): no counter-step past the issuance window; a stale counter credential delivered anyway is acknowledged at buffering and never accepted (5.6 step 6, 4.3)', async () => {
  const A = await person(0x72), B = await person(0x73)
  const { recB } = await bundled(A, B)
  const [b] = await B.h.contacts()
  assert.deepEqual(await B.h.counter(b.id, opts(T0 + 25 * H)), { ok: false, code: 'stale-issuance', ref: 'RLTP-ENC-5530' })
  assert.equal((await records(B))[0].out, null, 'nothing issued')
  const env = await deliveryFrom(B, recB, { ceremony: { step: 'counter', enactment: recB.bind }, when: T0 + 25 * H })
  const r = await A.h.receive(env, T0 + 25 * H + 1000)
  assert.ok(isAck(r), JSON.stringify(r))
  assert.deepEqual(ev(r, 'encounter.accepted'), [], 'rejected locally (ERR_STALE_ISSUANCE), never signaled')
  assert.equal((await records(A))[0].in, null, 'not an encounter credential: not counted')
  assert.equal((await A.h.contacts())[0].verification, 'outgoing')
})

test('encounter (ported from review 1): digest equality over decoded bytes — a z-rendered enactment binding is accepted on the counter-step and in a bundle', async () => {
  const A = await person(0x74), B = await person(0x75)
  const { recB } = await bundled(A, B)
  const zBind = 'z' + base58(fromB64u(recB.bind.slice(1)))
  const ctxB = await ctxOfRecord(B, recB)
  const credZ = await issueCredential(ctxB, recB.counterpart, CEREMONY, recB.peer, zBind, iso(T0 + 3000))
  const r = await A.h.receive(await deliveryFrom(B, recB, { credential: credZ, ceremony: { step: 'counter', enactment: zBind } }), T0 + 4000)
  assert.ok(isAck(r), JSON.stringify(r))
  assert.deepEqual(ev(r, 'encounter.accepted').map((e) => e.mutual), [true], 'binding and ceremony.enactment compare over bytes')
  // the bundle side
  const A2 = await person(0x76), B2 = await person(0x77)
  const { card, bundle } = await scanned(A2, B2)
  const [recA2] = await records(A2)
  const ctxA2 = await ctxOfRecord(A2, recA2)
  const doc = await openAt(B2, bundle.envelope)
  const zb = 'z' + base58(fromB64u(recA2.bind.slice(1)))
  const credZb = await issueCredential(ctxA2, card.anchor, CEREMONY, card.challenge.value, zb, doc.payload.credential.validFrom)
  const r2 = await B2.h.receive(await seal({ ...doc, id: randomUUID(), payload: { ...doc.payload, credential: credZb } }, card.keyAgreement), T0 + 2000)
  assert.ok(isAck(r2), JSON.stringify(r2))
  assert.deepEqual(ev(r2, 'encounter.recorded').map((e) => e.role), ['displayer'], 'the z-rendered binding recomputes (bytes)')
})

test('encounter (ported from review 1): cards outside their profile never enter an enactment — boundTo without sentTo, a displayed card carrying sentTo and boundTo (6070), a sent card whose challenge lacks issuedAt', async () => {
  const A = await person(0x78), B = await person(0x79)
  const card = await shownCard(B, T0, 'Bea')
  const ctxB = await labeledContext(B.seed, await labelOfKey(B, card.keyAgreement))
  const { proof, ...body } = card
  const half = await signCard(ctxB, { ...body, boundTo: card.challenge.value }, proof.created)
  assert.deepEqual(await A.h.scan(half, opts(T0 + 1000)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6010' })
  const sentLike = await signCard(ctxB, { ...body, sentTo: body.anchor, boundTo: 'B'.repeat(22) }, proof.created)
  assert.deepEqual(await A.h.scan(sentLike, opts(T0 + 1000)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6070' })
  assert.deepEqual(await A.h.contacts(), [])
  assert.deepEqual((await A.read()).encounter.records, {})
  // the sent card without its challenge time
  const sc = await A.h.scan(card, opts(T0 + 1000))
  const [recA] = await records(A)
  const ctxA = await ctxOfRecord(A, recA)
  const sent = ev(sc, 'encounter.scanned')[0].card
  const { proof: p2, ...sb } = sent
  const noTime = await signCard(ctxA, { ...sb, challenge: { value: sb.challenge.value } }, p2.created)
  assert.deepEqual(await B.h.captureSentCard(noTime, opts(T0 + 2000)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6010' })
  assert.deepEqual((await B.read()).encounter.records, {})
  assert.equal(resolveChallenge(await B.read(), card.challenge.value, T0 + 2000), 'open')
})

test('encounter (ported from review 1/3/4): the Entropy port — a repeated own challenge, a c_A equal to the displayed value, a repeated pair nonce or thread never commit; one draw that hits the displayed value is drawn again (4150, 5150, 5160, 5170)', async () => {
  const eB = steerable()
  const B = await person(0x7a, { entropy: eB })
  const cB = new Uint8Array(17).fill(0xb7)
  eB.force('challenge', cB)
  const card = await shownCard(B, T0)
  assert.equal(card.challenge.value, challengeOf(cB))
  // one colliding draw: drawn again, c_A ≠ c_B
  const e1 = steerable()
  const A1 = await person(0x7b, { entropy: e1 })
  e1.force('challenge', cB)
  const s1 = await A1.h.scan(card, opts(T0 + 1000))
  assert.equal(s1.ok, true)
  assert.notEqual(ev(s1, 'encounter.scanned')[0].card.challenge.value, card.challenge.value)
  // every draw colliding: no enactment at all
  const e2 = steerable()
  const A2 = await person(0x7c, { entropy: e2 })
  e2.force('challenge', cB, cB, cB, cB, cB)
  await assert.rejects(A2.h.scan(card, opts(T0 + 1000)), /distinct from the displayed/)
  assert.deepEqual([(await A2.read()).encounter.records, await A2.h.contacts()], [{}, []])
  // a repeated own challenge on a second scan: refused, the first record stands untouched
  const C = await person(0x7d)
  const cardC = await shownCard(C, T0)
  const e3 = steerable()
  const A3 = await person(0x7e, { entropy: e3 })
  const own = new Uint8Array(17).fill(0x33)
  e3.force('challenge', own, own)
  assert.equal((await A3.h.scan(card, opts(T0 + 1000))).ok, true)
  const before = await A3.read()
  await assert.rejects(A3.h.scan(cardC, opts(T0 + 1500)), /own challenge is not fresh/)
  assert.deepEqual((await A3.read()).encounter.records, before.encounter.records)
  assert.equal((await A3.h.contacts()).length, 1)
  // a displayer's repeated challenge while it is held
  const e4 = steerable()
  const P = await person(0x7f, { entropy: e4 })
  const z = new Uint8Array(17).fill(0x44)
  e4.force('challenge', z, z)
  await shownCard(P, T0)
  await assert.rejects(P.h.show(opts(T0 + 1000)), /challenge value is not fresh/)
  assert.equal(Object.keys((await P.read()).encounter.challenges).length, 1)
  // fresh-always: a repeated pair nonce, on show and on scan
  const n = new Uint8Array(32).fill(9)
  e4.force('founding.nonce', n, n, n)
  await shownCard(P, T0 + 2000)
  await assert.rejects(P.h.show(opts(T0 + 3000)), /pair label .* is not fresh/)
  await assert.rejects(P.h.scan(cardC, opts(T0 + 3000)), /pair label .* is not fresh/)
  // a repeated thread on the scanner
  const D = await person(0x80)
  const cardD = await shownCard(D, T0)
  const tid = randomUUID()
  e3.force('thread.id', tid, tid)
  const A4card = await shownCard(await person(0x81), T0)
  assert.equal((await A3.h.scan(A4card, opts(T0 + 2000))).ok, true)
  await assert.rejects(A3.h.scan(cardD, opts(T0 + 2500)), /thread is not fresh/)
  assert.equal((await A3.h.contacts()).length, 2)
})

test('encounter (ported from review 1): a credential with a broken proof (format valid) is ERR_SIG before addressee, record and binding — refused at stage 8, nothing consumed', async () => {
  const A = await person(0x82), B = await person(0x83)
  const { card, bundle } = await scanned(A, B)
  const doc = await openAt(B, bundle.envelope)
  const tampered = { ...doc.payload.credential, validFrom: iso(T0 + 3000) }
  const r = await B.h.receive(await seal({ ...doc, id: randomUUID(), payload: { ...doc.payload, credential: tampered } }, card.keyAgreement), T0 + 2000)
  assert.deepEqual(failed(r), ['failed', 'validation-failed', 8, 'RLTP-ENC-5490'])
  assert.deepEqual((await B.read()).encounter.records, {})
  assert.equal(resolveChallenge(await B.read(), card.challenge.value, T0 + 2000), 'open', 'nothing consumed')
})

// ── review 2 ───────────────────────────────────────────────────────────

test('encounter (ported from review 2): a sent card whose keyAgreement is pattern-valid but does not decode is refused optically (6010) and in a bundle (stage 8); no record', async () => {
  const A = await person(0x84), B = await person(0x85)
  const { card, sc, bundle } = await scanned(A, B)
  const [recA] = await records(A)
  const ctxA = await ctxOfRecord(A, recA)
  const sent = ev(sc, 'encounter.scanned')[0].card
  const { proof, ...body } = sent
  const badKa = await signCard(ctxA, { ...body, keyAgreement: 'z6LS' + '1'.repeat(44) }, proof.created)
  assert.deepEqual(await B.h.captureSentCard(badKa, opts(T0 + 2000)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6010' })
  const doc = await openAt(B, bundle.envelope)
  const r = await B.h.receive(await seal({ ...doc, id: randomUUID(), payload: { ...doc.payload, card: badKa } }, card.keyAgreement), T0 + 2500)
  assert.deepEqual(failed(r), ['failed', 'validation-failed', 8, undefined])
  assert.deepEqual((await B.read()).encounter.records, {})
  assert.equal(resolveChallenge(await B.read(), card.challenge.value, T0 + 2500), 'open')
})

test('encounter (ported from review 2/3/5): format failures of a delivered credential — an undecodable enactmentBinding, an undecodable verificationMethod, a foreign ceremony version — are ERR_VERSION: acknowledged at buffering, never accepted', async () => {
  const A = await person(0x86), B = await person(0x87)
  const { recB } = await bundled(A, B)
  const ctxB = await ctxOfRecord(B, recB)
  const at = iso(T0 + 3000)
  const badBind = await issueCredential(ctxB, recB.counterpart, CEREMONY, recB.peer, 'u' + 'A'.repeat(46), at)
  const good = await issueCredential(ctxB, recB.counterpart, CEREMONY, recB.peer, recB.bind, at)
  const fake = 'z6Mk' + '1'.repeat(44)
  const badVm = { ...good, proof: { ...good.proof, verificationMethod: `did:key:${fake}#${fake}` } }
  const oldCer = await issueCredential(ctxB, recB.counterpart, 'encounter-scan@0.1', recB.peer, recB.bind, at)
  for (const [name, credential] of [['binding', badBind], ['verificationMethod', badVm], ['ceremony', oldCer]]) {
    const r = await A.h.receive(await deliveryFrom(B, recB, { credential }), T0 + 4000)
    assert.ok(isAck(r), `${name}: ${JSON.stringify(r)}`)
    assert.deepEqual(ev(r, 'encounter.accepted'), [], name)
  }
  assert.equal((await records(A))[0].in, null, 'nothing accepted')
  // the genuine credential is still accepted afterwards
  const ok = await A.h.receive(await deliveryFrom(B, recB, { credential: good }), T0 + 5000)
  assert.deepEqual(ev(ok, 'encounter.accepted').map((e) => e.mutual), [true])
})

test('encounter (ported from review 2): a valid signed ack whose ref is the z-rendering of the bundle digest marks the bundle delivered (Delivery 4.2: ref accepted as u or z)', async () => {
  const A = await person(0x88), B = await person(0x89)
  const { bundle, got, recB } = await bundled(A, B)
  const ackDoc = await openAt(A, got.outbound[0].envelope)
  const { proof: _p, ...body } = ackDoc
  const ctxB = await ctxOfRecord(B, recB)
  const zRef = 'z' + base58(fromB64u(body.payload.ref.slice(1)))
  const zAck = await diSign(ctxB, { ...body, id: randomUUID(), payload: { ...body.payload, ref: zRef } }, body.issuedAt)
  const r = await A.h.receive(await seal(zAck, got.outbound[0].recipient.keyAgreement), T0 + 3000)
  assert.equal(r.disposition, 'unique', JSON.stringify(r))
  assert.equal((await A.h.deliveryStatus(bundle.digest)).items[0].status, 'delivered')
})

test('encounter (ported from review 2/14): a deactivated tuple still takes the late signed ack and the late counter credential; a counter credential issued on the optical leg goes out with the late bundle; a new counter issuance on a deactivated tuple is refused', async () => {
  const deactivate = (P, label) => edit(P.store, (s) => {
    for (const r of Object.values(s.relationships)) for (const t of r.tuples) if (t.ownPairLabel === label) t.deactivated = true
  })
  // the scanner's tuple deactivated before the ack and the counter-step arrive
  const A = await person(0x8a), B = await person(0x8b)
  const { bundle, got, recA } = await bundled(A, B)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 3000))
  await deactivate(A, recA.label)
  A.h = await restart(A, { invariants: false })
  assert.equal((await A.h.receive(got.outbound[0].envelope, T0 + 4000)).disposition, 'unique')
  assert.equal((await A.h.deliveryStatus(bundle.digest)).items[0].status, 'delivered', 'late valid ack: delivered (6.1)')
  const rc = await A.h.receive(d.outbound.find((o) => o.type === DELIVERY).envelope, T0 + 5000)
  assert.ok(isAck(rc), JSON.stringify(rc))
  assert.deepEqual(ev(rc, 'encounter.accepted').map((e) => e.mutual), [true], 'late counter credential accepted against the record (4.2)')
  // the displayer's tuple deactivated between the optical counter-step and the bundle
  const A2 = await person(0x8c), B2 = await person(0x8d)
  const s2 = await scanned(A2, B2)
  assert.equal((await B2.h.captureSentCard(ev(s2.sc, 'encounter.scanned')[0].card, opts(T0 + 1500))).ok, true)
  const [p2] = await B2.h.prompts()
  assert.deepEqual((await B2.h.decide(p2.id, 'accept', opts(T0 + 1600))).outbound, [])
  await deactivate(B2, (await records(B2))[0].label)
  B2.h = await restart(B2, { invariants: false })
  const late = await B2.h.receive(s2.bundle.envelope, T0 + 4000)
  const ctr = late.outbound.find((o) => o.type === DELIVERY)
  assert.ok(ctr, 'the already issued counter document materializes with the bundle')
  assert.equal((await records(B2))[0].counterPending, false)
  const back = await A2.h.receive(ctr.envelope, T0 + 5000)
  assert.deepEqual(ev(back, 'encounter.accepted').map((e) => e.mutual), [true])
  // no NEW issuance on a deactivated tuple
  const A3 = await person(0x8e), B3 = await person(0x8f)
  const { recB: recB3 } = await bundled(A3, B3)
  await deactivate(B3, recB3.label)
  B3.h = await restart(B3, { invariants: false })
  const [b3] = await B3.h.contacts()
  assert.deepEqual(await B3.h.counter(b3.id, opts(T0 + 3000)), { ok: false, code: 'tuple-deactivated' })
  const [p3] = await B3.h.prompts()
  assert.deepEqual(await B3.h.decide(p3.id, 'accept', opts(T0 + 3100)), { ok: false, code: 'tuple-deactivated' })
  assert.equal((await records(B3))[0].out, null)
})

test('encounter (ported from review 2): concurrent counter-steps on one contact — one credential, one document', async () => {
  const A = await person(0x90), B = await person(0x91)
  await bundled(A, B)
  const [b] = await B.h.contacts()
  const [prompt] = await B.h.prompts()
  const rs = await Promise.all([
    B.h.counter(b.id, opts(T0 + 3000)), B.h.counter(b.id, opts(T0 + 3000)), B.h.decide(prompt.id, 'accept', opts(T0 + 3000)),
  ])
  assert.equal(rs.filter((r) => r.ok).length, 1, JSON.stringify(rs))
  assert.ok(rs.filter((r) => !r.ok).every((r) => r.code === 'already-issued' || r.code === 'unknown-prompt'), JSON.stringify(rs))
  const s = await B.read()
  assert.equal(Object.values(s.outbox).filter((o) => o.type === DELIVERY).length, 1)
})

// ── review 3, 16: check order ──────────────────────────────────────────

test('encounter (ported from review 3/16): 4.1 check order — a calendar-invalid credential beside a broken card proof fails at the form check, a broken card proof beside a foreign ceremony at the card proof (6020), a foreign ceremony alone at 5520; nothing consumed', async () => {
  const A = await person(0x92), B = await person(0x93)
  const { card, bundle } = await scanned(A, B)
  const [recA] = await records(A)
  const ctxA = await ctxOfRecord(A, recA)
  const doc = await openAt(B, bundle.envelope)
  const badCard = structuredClone(doc.payload.card)
  badCard.proof.proofValue = flip(badCard.proof.proofValue)
  const badCal = { ...doc.payload.credential, validFrom: '2026-02-30T10:00:00Z' }
  const send = async (payload, when) => B.h.receive(await seal({ ...doc, id: randomUUID(), payload }, card.keyAgreement), when)
  const r1 = await send({ card: badCard, credential: badCal }, T0 + 2000)
  assert.equal(r1.disposition, 'failed')
  assert.deepEqual(failed(r1), ['failed', 'validation-failed', 8, undefined], 'the format names the disposition, not the card proof')
  const foreign = await issueCredential(ctxA, card.anchor, 'encounter-scan@0.24', card.challenge.value, recA.bind, doc.payload.credential.validFrom)
  assert.deepEqual(failed(await send({ card: badCard, credential: foreign }, T0 + 2000)), ['failed', 'validation-failed', 8, 'RLTP-ENC-6020'])
  assert.deepEqual(failed(await send({ card: doc.payload.card, credential: foreign }, T0 + 2000)), ['failed', 'validation-failed', 8, 'RLTP-ENC-5520'])
  assert.deepEqual((await B.read()).encounter.records, {})
  assert.equal(resolveChallenge(await B.read(), card.challenge.value, T0 + 2000), 'open')
  void r1
})

test('encounter (ported from review 3/6): a delivered credential bound to a held, record-less challenge is ERR_NO_RECORD; one with a broken signature bound to it ERR_SIG — both acknowledged, never accepted, the held value untouched by the delivery', async () => {
  const A = await person(0x94), B = await person(0x95)
  const { recB } = await bundled(A, B)
  const extra = await shownCard(A, T0 + 3000)   // a held, record-less value on A
  const ctxB = await ctxOfRecord(B, recB)
  const noRec = await issueCredential(ctxB, recB.counterpart, CEREMONY, extra.challenge.value, recB.bind, iso(T0 + 4000))
  const r1 = await A.h.receive(await deliveryFrom(B, recB, { credential: noRec, when: T0 + 4000 }), T0 + 4000)
  assert.ok(isAck(r1), JSON.stringify(r1))
  assert.deepEqual(ev(r1, 'encounter.accepted'), [])
  const good = await issueCredential(ctxB, recB.counterpart, CEREMONY, recB.peer, recB.bind, iso(T0 + 5000))
  const badSig = { ...good, credentialSubject: { ...good.credentialSubject, challenge: extra.challenge.value } }
  const r2 = await A.h.receive(await deliveryFrom(B, recB, { credential: badSig, when: T0 + 5000 }), T0 + 5000)
  assert.ok(isAck(r2), JSON.stringify(r2))
  assert.deepEqual(ev(r2, 'encounter.accepted'), [])
  assert.equal((await records(A))[0].in, null)
  assert.ok((await A.read()).encounter.challenges[extra.challenge.value], 'the held value stays: no resolution ran on it')
})

// ── review 4, 5, 13: the credential delivery's rules ───────────────────

test('encounter (ported from review 4/5): the counter-step\'s rules — a lying ceremony.enactment (stage 8), a counter outside the bundle thread, a deliver inside it (stage 9) are refused with no ack; the true counter-step carries the recomputable enactment and is accepted mutual (4.3, 5760)', async () => {
  const A = await person(0x96), B = await person(0x97)
  const { recB, bundle } = await bundled(A, B)
  const seq = await seqOf(A)
  const wrong = await binding(CEREMONY, 'x'.repeat(22), 'y'.repeat(22))
  assert.deepEqual(failed(await A.h.receive(await deliveryFrom(B, recB, { ceremony: { step: 'counter', enactment: wrong } }), T0 + 4000)), ['failed', 'validation-failed', 8, 'RLTP-ENC-5760'])
  assert.deepEqual(failed(await A.h.receive(await deliveryFrom(B, recB, { ceremony: { step: 'counter' }, threadId: randomUUID() }), T0 + 4000)), ['failed', 'validation-failed', 9, 'RLTP-ENC-5760'])
  assert.deepEqual(failed(await A.h.receive(await deliveryFrom(B, recB, { ceremony: { step: 'deliver' } }), T0 + 4000)), ['failed', 'validation-failed', 9, undefined])
  assert.equal(await seqOf(A), seq, 'nothing committed')
  assert.equal((await records(A))[0].in, null)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 5000))
  const counter = d.outbound.find((o) => o.type === DELIVERY)
  const cdoc = await openAt(A, counter.envelope)
  assert.deepEqual([cdoc.ceremony.step, cdoc.threadId], ['counter', bundle.threadId])
  assert.equal(cdoc.ceremony.enactment, cdoc.payload.credential.credentialSubject.enactmentBinding, 'the ceremony member carries the recomputable enactment (4.3)')
  assert.deepEqual(ev(await A.h.receive(counter.envelope, T0 + 6000), 'encounter.accepted').map((e) => e.mutual), [true])
})

test('encounter (ported from review 13): an unknown framework ceremony.step passes through (Delivery §3) — the thread rule binds only counter and deliver', async () => {
  const A = await person(0x98), B = await person(0x99)
  const { recB } = await bundled(A, B)
  const r = await A.h.receive(await deliveryFrom(B, recB, { ceremony: { step: 'future-framework-step' } }), T0 + 4000)
  assert.ok(isAck(r), JSON.stringify(r))
  assert.deepEqual(ev(r, 'encounter.accepted').map((e) => e.mutual), [true])
})

test('encounter (ported from review 6/10): a standalone delivery reserves its fresh thread — a second, digest-different one on it is refused with no ack; two concurrent ones on one fresh thread: exactly one buffered and acknowledged', async () => {
  const A = await person(0x9a), B = await person(0x9b)
  const { recB } = await bundled(A, B)
  const tid = randomUUID()
  const first = await A.h.receive(await deliveryFrom(B, recB, { threadId: tid, ceremony: { step: 'deliver' } }), T0 + 4000)
  assert.ok(isAck(first), JSON.stringify(first))
  assert.deepEqual(ev(first, 'encounter.accepted').map((e) => e.mutual), [true])
  const second = await A.h.receive(await deliveryFrom(B, recB, { threadId: tid, ceremony: { step: 'deliver' } }), T0 + 4500)
  assert.deepEqual(failed(second), ['failed', 'validation-failed', 9, undefined])
  // concurrency
  const A2 = await person(0x9c), B2 = await person(0x9d)
  const { recB: rb2 } = await bundled(A2, B2)
  const tid2 = randomUUID()
  const envs = await Promise.all([1, 2, 3].map(() => deliveryFrom(B2, rb2, { threadId: tid2, ceremony: { step: 'deliver' } })))
  const rs = await Promise.all(envs.map((e) => A2.h.receive(e, T0 + 4000)))
  assert.equal(rs.filter(isAck).length, 1, JSON.stringify(rs.map(failed)))
  assert.ok(rs.filter((r) => r.disposition === 'failed').every((r) => r.reason === 'validation-failed' && r.stage === 9))
  assert.equal(Object.keys((await records(A2))[0].threads).length, 1)
})

// ── review 5, 6: copies ────────────────────────────────────────────────

test('encounter (ported from review 5/6): the holder binds and hands out copies — a card mutated after the call never reaches the record; a mutated ack or bundle never alters the stored one; re-ack and re-emission are byte-identical', async () => {
  const A = await person(0x9e), B = await person(0x9f)
  const card = await shownCard(B, T0, 'Bea')
  const input = structuredClone(card)
  const pendingScan = A.h.scan(input, opts(T0 + 1000, { name: 'Al' }))
  input.name = 'MUTATED'
  const sc = await pendingScan
  assert.equal(sc.ok, true, JSON.stringify(sc))
  assert.equal((await records(A))[0].card.name, 'Bea')
  const sent = structuredClone(ev(sc, 'encounter.scanned')[0].card)
  const pendingCap = B.h.captureSentCard(sent, opts(T0 + 1500))
  sent.name = 'UNSIGNED-MUTATION'
  assert.equal((await pendingCap).ok, true)
  assert.equal((await records(B))[0].card.name, 'Al')
  assert.equal((await B.h.contacts())[0].displayName, 'Al')
  // returned envelopes: the host's handle is not the stored one
  const bundle = sc.outbound.find((o) => o.type === BUNDLE)
  const orig = structuredClone(bundle.envelope)
  const smash = (env) => { for (const k of Object.keys(env)) if (typeof env[k] === 'string') try { env[k] = 'XXXX' } catch { /* frozen */ } }
  smash(bundle.envelope)
  const re = (await A.h.resume(T0 + 40_000)).outbound.find((o) => o.type === BUNDLE)
  assert.equal(jcs(re.envelope), jcs(orig), 'the outbox kept its own copy')
  smash(re.envelope)
  const re2 = (await A.h.resume(T0 + 400_000)).outbound.find((o) => o.type === BUNDLE)
  assert.equal(jcs(re2.envelope), jcs(orig), 're-emission is a copy too')
  const got = await B.h.receive(orig, T0 + 2000)
  const ack = structuredClone(got.outbound[0].envelope)
  smash(got.outbound[0].envelope)
  const dup = await B.h.receive(orig, T0 + 3000)
  assert.equal(dup.disposition, 'duplicate-known')
  assert.equal(jcs(dup.outbound[0].envelope), jcs(ack), 'the re-ack is the stored document, untouched by the host handle')
})

// ── review 7, 12, 13, 20: bundle thread freshness ──────────────────────

test('encounter (ported from review 7/12/13/20): bundle thread freshness — a second scanner\'s bundle on a used thread and a re-issued bundle on its old thread are refused; a re-issue on a fresh thread lands record-aware and reserves that thread; after the cache\'s retention it is taken again while a new document on it is refused', async () => {
  const A = await person(0xa0), B = await person(0xa1)
  const eX = steerable()
  const X = await person(0xa2, { entropy: eX })
  const { bundle, card } = await bundled(A, B)
  const card2 = await shownCard(B, T0 + 2500)
  eX.force('thread.id', bundle.threadId)
  const bx = (await X.h.scan(card2, opts(T0 + 3000))).outbound[0]
  assert.equal(bx.threadId, bundle.threadId)
  const rx = await B.h.receive(bx.envelope, T0 + 3500)
  assert.deepEqual(failed(rx), ['failed', 'validation-failed', 9, undefined])
  assert.equal((await records(B)).length, 1)
  assert.equal(resolveChallenge(await B.read(), card2.challenge.value, T0 + 3500), 'open', 'the second code is not consumed')
  // a re-issued bundle (new id, new digest) on the old thread
  const doc = await openAt(B, bundle.envelope)
  const reissue = async (threadId) => seal({ ...doc, id: randomUUID(), threadId }, card.keyAgreement)
  assert.deepEqual(failed(await B.h.receive(await reissue(bundle.threadId), T0 + 4000)), ['failed', 'validation-failed', 9, undefined])
  // … on a fresh thread: record-aware, idempotent, the record keeps its first thread
  const t2 = randomUUID()
  const env2 = await reissue(t2)
  const r2 = await B.h.receive(env2, T0 + 4500)
  assert.ok(isAck(r2), JSON.stringify(r2))
  assert.deepEqual(r2.events, [])
  const [rec] = await records(B)
  assert.equal(rec.thread, bundle.threadId)
  assert.deepEqual(Object.keys(rec.threads), [t2])
  // a further re-issue on that thread is not fresh
  assert.deepEqual(failed(await B.h.receive(await reissue(t2), T0 + 5000)), ['failed', 'validation-failed', 9, undefined])
  // after retention the same second bundle is taken again with a fresh ack; a new document on its thread still not
  const late = T0 + 91 * 86_400_000
  await B.h.tick(late)
  const r3 = await B.h.receive(env2, late + 1)
  assert.ok(isAck(r3), JSON.stringify(r3))
  assert.notEqual(jcs(r3.outbound[0].envelope), jcs(r2.outbound[0].envelope), 'a freshly generated ack')
  assert.deepEqual(failed(await B.h.receive(await reissue(t2), late + 2)), ['failed', 'validation-failed', 9, undefined])
  assert.equal((await records(B)).length, 1)
})

// ── review 8, 16: ack forms ────────────────────────────────────────────

test('encounter (ported from review 8/16): ack stage order — a signed ack with a foreign root member and a wrong recipient is malformed at stage 5; a correctly signed ack with an empty payload is malformed at stage 7; the bundle stays undelivered', async () => {
  const A = await person(0xa3), B = await person(0xa4)
  const { bundle, got, recB } = await bundled(A, B)
  const ackDoc = await openAt(A, got.outbound[0].envelope)
  const { proof: _p, ...body } = ackDoc
  const ctxB = await ctxOfRecord(B, recB)
  const to = got.outbound[0].recipient.keyAgreement
  const seq = await seqOf(A)
  const extra = await diSign(ctxB, { ...body, id: randomUUID(), recipient: ctxB.anchor, extraRoot: 1 }, body.issuedAt)
  assert.deepEqual(failed(await A.h.receive(await seal(extra, to), T0 + 3000)), ['failed', 'malformed', 5, undefined])
  const empty = await diSign(ctxB, { ...body, id: randomUUID(), payload: {} }, body.issuedAt)
  assert.deepEqual(failed(await A.h.receive(await seal(empty, to), T0 + 3000)), ['failed', 'malformed', 7, undefined])
  assert.equal(await seqOf(A), seq)
  assert.notEqual((await A.h.deliveryStatus(bundle.digest)).items[0].status, 'delivered')
  assert.equal((await A.h.receive(got.outbound[0].envelope, T0 + 3500)).disposition, 'unique', 'the genuine ack still lands')
})

// ── review 10, 22, 24: concurrency on one holder ───────────────────────

test('encounter (ported from review 10): two concurrent bundles from two scanners on one thread — exactly one record, one ack', async () => {
  const B = await person(0xa5)
  const e1 = steerable(), e2 = steerable()
  const A1 = await person(0xa6, { entropy: e1 }), A2 = await person(0xa7, { entropy: e2 })
  const c1 = await shownCard(B, T0), c2 = await shownCard(B, T0 + 100)
  const tid = randomUUID()
  e1.force('thread.id', tid); e2.force('thread.id', tid)
  const b1 = (await A1.h.scan(c1, opts(T0 + 1000))).outbound[0], b2 = (await A2.h.scan(c2, opts(T0 + 1000))).outbound[0]
  const rs = await Promise.all([B.h.receive(b1.envelope, T0 + 2000), B.h.receive(b2.envelope, T0 + 2000)])
  assert.equal(rs.filter(isAck).length, 1, JSON.stringify(rs.map(failed)))
  assert.deepEqual(failed(rs.find((r) => r.disposition === 'failed')), ['failed', 'validation-failed', 9, undefined])
  assert.equal((await records(B)).length, 1)
  assert.equal((await B.h.contacts()).length, 1)
})

test('encounter (ported from review 22/24): parallel scans of one displayed card — on one scanner one record, the rest already-scanned, and the counter-step for it lands; on 20 scanners delivered to the displayer exactly one enactment, the rest consumed-challenge', async () => {
  const A = await person(0xa8), B = await person(0xa9)
  const card = await shownCard(B, T0, 'Bea')
  const rs = await Promise.all(Array.from({ length: 20 }, () => A.h.scan(card, opts(T0 + 1000))))
  const ok = rs.filter((r) => r.ok)
  assert.equal(ok.length, 1)
  assert.ok(rs.filter((r) => !r.ok).every((r) => r.code === 'already-scanned' && r.ref === 'RLTP-ENC-5170'))
  assert.equal((await records(A)).length, 1)
  assert.equal((await A.h.contacts()).length, 1)
  const got = await B.h.receive(ok[0].outbound[0].envelope, T0 + 2000)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 3000))
  await settle([A, B], [...got.outbound, ...d.outbound], T0 + 4000)
  assert.equal((await A.h.contacts())[0].verification, 'mutual')
  // twenty scanners
  const D = await person(0xaa)
  const cardD = await shownCard(D, T0)
  const scanners = await Promise.all(Array.from({ length: 20 }, (_, i) => person(0xb0 + i)))
  const bundles = await Promise.all(scanners.map(async (S) => (await S.h.scan(cardD, opts(T0 + 1000))).outbound[0]))
  const got20 = await Promise.all(bundles.map((b) => D.h.receive(b.envelope, T0 + 2000)))
  assert.equal(got20.filter(isAck).length, 1)
  assert.ok(got20.filter((r) => r.disposition === 'failed').every((r) => r.reason === 'consumed-challenge' && r.stage === 9 && r.ref === 'RLTP-ENC-5440'), JSON.stringify(got20.map(failed)))
  assert.equal((await records(D)).length, 1)
  assert.equal((await D.h.contacts()).length, 1)
})

// ── review 11, 16, 18: the state moves between preparation and commit ──

test('encounter (ported from review 11): the state moves between preparation and commit and the operation re-runs on the new state — the optical leg and the bundle on a challenge another device aged out, the bundle after the same counterpart\'s optical leg, after a foreign one, a scan after another device scanned the code, a delivery after another reserved its thread', async () => {
  const other = (P, store) => createHolder({ store: store.inner, keys: P.keys }, { invariants: true })
  // optical, aged by another device's tick
  {
    const store = hookedStore()
    const A = await person(0xc8), B = await person(0xc9, { store })
    const { sc, card } = await scanned(A, B)
    const B2 = await other(B, store)
    store.hook = () => B2.tick(T0 + 11 * M)
    assert.deepEqual(await B.h.captureSentCard(ev(sc, 'encounter.scanned')[0].card, opts(T0 + 2000)), { ok: false, code: 'gate-expired', ref: 'RLTP-ENC-5460' })
    assert.deepEqual([(await B.read()).encounter.records, await B.h.contacts()], [{}, []])
    assert.equal((await B.read()).encounter.challenges[card.challenge.value], undefined)
  }
  // bundle on an open value, aged meanwhile: validation-failed, nothing consumed, no ack
  {
    const store = hookedStore()
    const A = await person(0xca), B = await person(0xcb, { store })
    const { bundle } = await scanned(A, B)
    const B2 = await other(B, store)
    store.hook = () => B2.tick(T0 + 11 * M)
    assert.deepEqual(failed(await B.h.receive(bundle.envelope, T0 + 2000)), ['failed', 'validation-failed', 9, 'RLTP-ENC-5240'])
    assert.deepEqual((await B.read()).encounter.records, {})
  }
  // bundle on an open value, recorded meanwhile by the same counterpart's optical leg: lands record-aware, one record
  {
    const store = hookedStore()
    const A = await person(0xcc), B = await person(0xcd, { store })
    const { sc, bundle } = await scanned(A, B)
    const B2 = await other(B, store)
    let cap
    store.hook = async () => { cap = await B2.captureSentCard(ev(sc, 'encounter.scanned')[0].card, opts(T0 + 1500)) }
    const r = await B.h.receive(bundle.envelope, T0 + 2000)
    assert.equal(cap.ok, true)
    assert.ok(isAck(r), JSON.stringify(r))
    assert.deepEqual(ev(r, 'encounter.recorded'), [], 'no second record')
    assert.equal((await records(B)).length, 1)
    assert.ok((await records(B))[0].in, 'the bundle\'s credential accepted via the record')
  }
  // bundle on an open value, recorded meanwhile by a FOREIGN counterpart: consumed-challenge, no ack
  {
    const store = hookedStore()
    const A = await person(0xce), X = await person(0xcf), B = await person(0xd0, { store })
    const { card, bundle } = await scanned(A, B)
    const sx = await X.h.scan(card, opts(T0 + 1100))
    const B2 = await other(B, store)
    store.hook = () => B2.captureSentCard(ev(sx, 'encounter.scanned')[0].card, opts(T0 + 1500))
    assert.deepEqual(failed(await B.h.receive(bundle.envelope, T0 + 2000)), ['failed', 'consumed-challenge', 9, 'RLTP-ENC-5440'])
    assert.equal((await records(B)).length, 1)
    assert.equal((await records(B))[0].counterpart, ev(sx, 'encounter.scanned')[0].card.anchor)
  }
  // scan: another device of the scanner scans the same code meanwhile
  {
    const store = hookedStore()
    const B = await person(0xd1), A = await person(0xd2, { store })
    const card = await shownCard(B, T0)
    const A2 = await other(A, store)
    store.hook = () => A2.scan(card, opts(T0 + 900))
    assert.deepEqual(await A.h.scan(card, opts(T0 + 1000)), { ok: false, code: 'already-scanned', ref: 'RLTP-ENC-5170' })
    assert.equal((await records(A)).length, 1)
  }
  // delivery: the fresh thread gets reserved meanwhile
  {
    const store = hookedStore()
    const A = await person(0xd3, { store }), B = await person(0xd4)
    const { recB } = await bundled(A, B)
    const tid = randomUUID()
    const [e1, e2] = [await deliveryFrom(B, recB, { threadId: tid, ceremony: { step: 'deliver' } }), await deliveryFrom(B, recB, { threadId: tid, ceremony: { step: 'deliver' } })]
    const A2 = await other(A, store)
    let firstR
    store.hook = async () => { firstR = await A2.receive(e1, T0 + 3900) }
    const r = await A.h.receive(e2, T0 + 4000)
    assert.ok(isAck(firstR))
    assert.deepEqual(failed(r), ['failed', 'validation-failed', 9, undefined])
  }
})

test('encounter (ported from review 16): the state moves six times between preparation and commit, then holds — the bundle lands on the seventh attempt', async () => {
  const store = hookedStore()
  const A = await person(0xd5), B = await person(0xd6, { store })
  const { card, bundle } = await scanned(A, B)
  let moves = 0
  const toggle = async () => {
    // the open value disappears and comes back: another writer, twice
    const s0 = (await store.inner.read()).state.encounter.challenges[card.challenge.value]
    await edit(store.inner, (s) => { delete s.encounter.challenges[card.challenge.value] })
    await edit(store.inner, (s) => { s.encounter.challenges[card.challenge.value] = s0 })
    if (++moves < 6) store.hook = toggle
  }
  store.hook = toggle
  const c0 = store.commits
  const r = await B.h.receive(bundle.envelope, T0 + 2000)
  assert.ok(isAck(r), JSON.stringify(r))
  assert.equal(moves, 6)
  assert.equal(store.commits - c0, 7, 're-entered six times, committed on the seventh')
  assert.equal((await records(B)).length, 1)
})

test('encounter (ported from review 18): the record and its relationship vanish (another writer) — a foreign bundle on the value is then validation-failed as unknown (5240), never consumed-challenge', async () => {
  // A refusal commits nothing, so no CAS can catch a state that moved under
  // it: the engine decides it on the one snapshot it read (prepare and apply
  // run on that snapshot), linearized there. Before the deletion the record
  // decides (consumed-challenge); after it the resolution does (unknown).
  const A = await person(0xd7), X = await person(0xd8), B = await person(0xd9)
  const { card } = await bundled(A, B)
  const bx = (await X.h.scan(card, opts(T0 + 1500))).outbound[0]
  assert.deepEqual(failed(await B.h.receive(bx.envelope, T0 + 2500)), ['failed', 'consumed-challenge', 9, 'RLTP-ENC-5440'])
  const [b] = await B.h.contacts()
  assert.equal((await B.h.depart(b.id, opts(T0 + 2600))).ok, true)
  await edit(B.store, (s) => { delete s.encounter.records[card.challenge.value] })
  B.h = await restart(B)
  const seq = await seqOf(B)
  assert.deepEqual(failed(await B.h.receive(bx.envelope, T0 + 2700)), ['failed', 'validation-failed', 9, 'RLTP-ENC-5240'])
  assert.equal(await seqOf(B), seq, 'nothing committed (the value was not held: no latch)')
  assert.deepEqual(await B.h.contacts(), [])
})

test('encounter (ported from review 23): a re-encounter whose optical record was chained into the earlier relationship before its bundle arrived — the late bundle is accepted under the chain\'s entry and carries the waiting counter-step out on the appended tuple; the counterpart accepts it under its chain', async () => {
  const A = await communityPerson(0xf5), B = await communityPerson(0xf6)
  const { a, b } = await met(A, B)
  const ta = await A.h.trust(a.id, opts(T0 + 5000)), tb = await B.h.trust(b.id, opts(T0 + 5000))
  await settle([A, B], [...ta.outbound, ...tb.outbound], T0 + 6000)
  // the second encounter: optical leg and counter-step first, the bundle withheld
  const card = await shownCard(B, T0 + 10_000)
  const sc = await A.h.scan(card, opts(T0 + 11_000))
  const bundle = sc.outbound.find((o) => o.type === BUNDLE)
  assert.equal((await B.h.captureSentCard(ev(sc, 'encounter.scanned')[0].card, opts(T0 + 12_000))).ok, true)
  const prompt = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  assert.deepEqual((await B.h.decide(prompt.id, 'accept', opts(T0 + 13_000))).outbound, [])
  await settle([A, B], [], T0 + 14_000, { keep: (o) => o.type !== BUNDLE })
  // B chained: the fresh tuple appended to the first relationship, which keeps its entry; the fresh one is a husk
  const s = await B.read()
  const rec2 = (await records(B)).find((r) => r.own === card.challenge.value)
  const chain = Object.values(s.relationships).find((r) => r.tuples.some((t) => t.ownPairLabel === rec2.label))
  assert.equal(chain.id, b.relationships[0].id, 'appended to the earlier relationship')
  assert.equal(s.relationships[rec2.relId].chainedInto, chain.id)
  assert.equal(chain.tuples.find((t) => t.ownPairLabel !== rec2.label).deactivated, true, 'the earlier tuple deactivated')
  const got = await B.h.receive(bundle.envelope, T0 + 20_000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  assert.deepEqual(ev(got, 'encounter.accepted').map((e) => [e.contactId, e.relationshipId, e.mutual]), [[b.id, chain.id, true]], 'under the chain, not the husk')
  const ctr = got.outbound.filter((o) => o.type === DELIVERY)
  assert.equal(ctr.length, 1)
  assert.deepEqual([ctr[0].threadId, ctr[0].recipient.contactId, ctr[0].recipient.rkid], [bundle.threadId, b.id, card.keyAgreement])
  const back = await A.h.receive(ctr[0].envelope, T0 + 21_000)
  assert.deepEqual(ev(back, 'encounter.accepted').map((e) => [e.contactId, e.mutual]), [[a.id, true]])
  assert.deepEqual((await B.h.contacts()).map((c) => [c.id, c.verification]), [[b.id, 'mutual']])
})

// ── review 12, 13, 15, 22: failure, restart, resume ────────────────────

test('encounter (ported from review 12/22): a scan whose sealing fails commits nothing — no record, no tuple, no consumed value, no outbox; the next scan of the same card succeeds and lands (5630: record and issuance in one commit)', async () => {
  const e = steerable()
  const A = await person(0xda, { entropy: e }), B = await person(0xdb)
  const card = await shownCard(B, T0)
  const seq = await seqOf(A)
  e.force('seal.nonce', new Uint8Array(5))
  await assert.rejects(A.h.scan(card, opts(T0 + 1000)))
  const s = await A.read()
  assert.equal(s.commitSeq, seq)
  assert.deepEqual([s.encounter.records, s.outbox, s.relationships], [{}, {}, {}])
  const ok = await A.h.scan(card, opts(T0 + 1100))
  assert.equal(ok.ok, true)
  assert.equal((await B.h.receive(ok.outbound[0].envelope, T0 + 2000)).disposition, 'unique')
})

test('encounter (ported from review 12/22): a restart between the optical counter-step and the bundle — the new holder sends the waiting counter document with the bundle, once; a redelivered bundle sends none again', async () => {
  const A = await person(0xdc), B = await person(0xdd)
  const { sc, bundle } = await scanned(A, B)
  assert.equal((await B.h.captureSentCard(ev(sc, 'encounter.scanned')[0].card, opts(T0 + 1500))).ok, true)
  const [prompt] = await B.h.prompts()
  assert.equal((await B.h.decide(prompt.id, 'accept', opts(T0 + 1600))).ok, true)
  B.h = await restart(B)
  assert.deepEqual((await B.h.resume(T0 + 2000)).outbound.filter((o) => o.type === DELIVERY), [], 'no thread yet, nothing to send')
  const got = await B.h.receive(bundle.envelope, T0 + 3000)
  const ctr = got.outbound.filter((o) => o.type === DELIVERY)
  assert.equal(ctr.length, 1)
  assert.equal(ctr[0].threadId, bundle.threadId)
  const dup = await B.h.receive(bundle.envelope, T0 + 4000)
  assert.deepEqual(dup.outbound.map((o) => o.type), [ACK], 'duplicate-known: the stored ack only')
  assert.equal(Object.values((await B.read()).outbox).filter((o) => o.type === DELIVERY).length, 1)
  assert.deepEqual(ev(await A.h.receive(ctr[0].envelope, T0 + 5000), 'encounter.accepted').map((e) => e.mutual), [true])
})

test('encounter (ported from review 13): parallel resumes after a restart re-emit the bundle once', async () => {
  const A = await person(0xde), B = await person(0xdf)
  const { bundle } = await scanned(A, B)
  A.h = await restart(A)
  const [x, y] = await Promise.all([A.h.resume(T0 + 40_000), A.h.resume(T0 + 40_000)])
  const all = [...x.outbound, ...y.outbound].filter((o) => o.type === BUNDLE)
  assert.equal(all.length, 1)
  assert.equal(jcs(all[0].envelope), jcs(bundle.envelope))
  assert.equal((await A.read()).outbox[bundle.digest].attempt, 2)
})

test('encounter (ported from review 15): an outboxed bundle survives its tuple\'s deactivation — resume re-emits it once, byte-identical, and it lands', async () => {
  const A = await person(0xe0), B = await person(0xe1)
  const { bundle } = await scanned(A, B)
  const [recA] = await records(A)
  await edit(A.store, (s) => { for (const r of Object.values(s.relationships)) for (const t of r.tuples) if (t.ownPairLabel === recA.label) t.deactivated = true })
  A.h = await restart(A, { invariants: false })
  const res = await A.h.resume(T0 + 40_000)
  const re = res.outbound.filter((o) => o.type === BUNDLE)
  assert.equal(re.length, 1)
  assert.equal(jcs(re[0].envelope), jcs(bundle.envelope))
  assert.deepEqual((await A.h.resume(T0 + 40_001)).outbound.filter((o) => o.type === BUNDLE), [])
  assert.deepEqual(ev(await B.h.receive(re[0].envelope, T0 + 41_000), 'encounter.recorded').map((e) => e.role), ['displayer'])
})

// ── review 13 B-2, 18 B-1, 19: refusals the record never sees ──────────

test('encounter (ported from review 13): a sent card coherently re-signed with sentTo = another displayed anchor of B is refused on the optical leg (6050) and in a bundle — addressed there, at the enacting anchor (4100); addressed to the first, at the sent-card binding; no record, both challenges open', async () => {
  const A = await person(0xe2), B = await person(0xe3)
  const c1 = await shownCard(B, T0), c2 = await shownCard(B, T0 + 100)
  const sc = await A.h.scan(c1, opts(T0 + 1000))
  const [recA] = await records(A)
  const ctxA = await ctxOfRecord(A, recA)
  const { proof, ...body } = ev(sc, 'encounter.scanned')[0].card
  const forged = await signCard(ctxA, { ...body, sentTo: c2.anchor }, proof.created)
  assert.deepEqual(await B.h.captureSentCard(forged, opts(T0 + 2000)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6050' })
  const at = iso(T0 + 1000)
  const bundleTo = async (to) => {
    const credential = await issueCredential(ctxA, to.anchor, CEREMONY, c1.challenge.value, recA.bind, at)
    const doc = { id: randomUUID(), type: BUNDLE, issuer: ctxA.anchor, recipient: to.anchor, threadId: randomUUID(), issuedAt: at, payload: { card: forged, credential } }
    return seal(doc, to.keyAgreement)
  }
  assert.deepEqual(failed(await B.h.receive(await bundleTo(c2), T0 + 2500)), ['failed', 'validation-failed', 8, 'RLTP-ENC-4100'])
  assert.deepEqual(failed(await B.h.receive(await bundleTo(c1), T0 + 2500)), ['failed', 'validation-failed', 8, undefined])
  const s = await B.read()
  assert.deepEqual(s.encounter.records, {})
  assert.deepEqual([resolveChallenge(s, c1.challenge.value, T0 + 2500), resolveChallenge(s, c2.challenge.value, T0 + 2500)], ['open', 'open'], 'nothing consumed')
})

test('encounter (ported from review 18): a bundle whose sent card reuses the displayed challenge as its own (c_A = c_B) is refused at stage 8; nothing consumed', async () => {
  const A = await person(0xe4), B = await person(0xe5)
  const { card, sc } = await scanned(A, B)
  const [recA] = await records(A)
  const ctxA = await ctxOfRecord(A, recA)
  const { proof, ...body } = ev(sc, 'encounter.scanned')[0].card
  const reused = await signCard(ctxA, { ...body, challenge: { value: card.challenge.value, issuedAt: body.challenge.issuedAt } }, proof.created)
  const bind = await binding(CEREMONY, card.challenge.value, card.challenge.value)
  const credential = await issueCredential(ctxA, card.anchor, CEREMONY, card.challenge.value, bind, body.challenge.issuedAt)
  const doc = { id: randomUUID(), type: BUNDLE, issuer: ctxA.anchor, recipient: card.anchor, threadId: randomUUID(), issuedAt: body.challenge.issuedAt, payload: { card: reused, credential } }
  const seq = await seqOf(B)
  assert.deepEqual(failed(await B.h.receive(await seal(doc, card.keyAgreement), T0 + 2500)), ['failed', 'validation-failed', 8, undefined])
  assert.equal(await seqOf(B), seq)
  assert.equal(resolveChallenge(await B.read(), card.challenge.value, T0 + 2500), 'open')
})

test('encounter (ported from review 17): a second scanner\'s bundle 25 h late on a recorded challenge is stale-issuance at stage 8 (check 6 before the record\'s verdict); in its window consumed-challenge at stage 9', async () => {
  const A = await person(0xe6), X = await person(0xe7), B = await person(0xe8)
  const { card } = await bundled(A, B)
  const sx = await X.h.scan(card, opts(T0 + 1500))
  const bx = sx.outbound[0]
  assert.deepEqual(failed(await B.h.receive(bx.envelope, T0 + 3500)), ['failed', 'consumed-challenge', 9, 'RLTP-ENC-5440'])
  const [recX] = await records(X)
  const ctxX = await ctxOfRecord(X, recX)
  const doc = await openAt(B, bx.envelope)
  const late = await issueCredential(ctxX, card.anchor, CEREMONY, card.challenge.value, recX.bind, iso(T0 + 25 * H))
  const stale = await seal({ ...doc, id: randomUUID(), threadId: randomUUID(), payload: { ...doc.payload, credential: late } }, card.keyAgreement)
  assert.deepEqual(failed(await B.h.receive(stale, T0 + 25 * H + 1000)), ['failed', 'stale-issuance', 8, 'RLTP-ENC-5530'])
  assert.equal((await records(B)).length, 1)
})

test('encounter (ported from review 19): resolution before the ceremony check — a bundle under a foreign ceremony on an aged challenge latches it and is refused as unknown (5240), not 5520', async () => {
  const A = await person(0xe9), B = await person(0xea)
  const { card, bundle } = await scanned(A, B)
  const [recA] = await records(A)
  const ctxA = await ctxOfRecord(A, recA)
  const doc = await openAt(B, bundle.envelope)
  const old = await issueCredential(ctxA, card.anchor, 'encounter-scan@0.24', card.challenge.value, recA.bind, doc.payload.credential.validFrom)
  const r = await B.h.receive(await seal({ ...doc, id: randomUUID(), payload: { ...doc.payload, credential: old } }, card.keyAgreement), T0 + 11 * M)
  assert.deepEqual(failed(r), ['failed', 'validation-failed', 9, 'RLTP-ENC-5240'])
  const s = await B.read()
  assert.equal(s.encounter.challenges[card.challenge.value], undefined, 'the resolution latched')
  assert.equal(resolveChallenge(s, card.challenge.value, T0 + 1000), 'unknown', 'no way back')
})

// ── review 21, 23, 25 ──────────────────────────────────────────────────

test('encounter (ported from review 21): a display name longer than the card bound is cut to 200 characters on the displayed and the sent card; the receiver records it', async () => {
  const L = await person(0xeb), B = await person(0xec)
  const long = 'L'.repeat(230)
  const shown = await shownCard(L, T0, long)
  assert.equal(shown.name.length, 200)
  const card = await shownCard(B, T0)
  const sc = await L.h.scan(card, opts(T0 + 1000, { name: long }))
  assert.equal(ev(sc, 'encounter.scanned')[0].card.name.length, 200)
  const got = await B.h.receive(sc.outbound[0].envelope, T0 + 2000)
  assert.deepEqual(ev(got, 'encounter.recorded').map((e) => e.role), ['displayer'])
  assert.equal((await B.h.contacts())[0].displayName, 'L'.repeat(200))
})

test('encounter (ported from review 23): after the relationship\'s departure a redelivered bundle is duplicate-known with the stored ack, byte-identical', async () => {
  const A = await person(0xed), B = await person(0xee)
  const { bundle, got } = await bundled(A, B)
  const [b] = await B.h.contacts()
  const dep = await B.h.depart(b.id, opts(T0 + 3000))
  assert.equal(dep.ok, true, JSON.stringify(dep))
  assert.deepEqual(await B.h.contacts(), [])
  const again = await B.h.receive(bundle.envelope, T0 + 4000)
  assert.equal(again.disposition, 'duplicate-known')
  assert.equal(jcs(again.outbound[0].envelope), jcs(got.outbound[0].envelope))
})

test('encounter (ported from review 25): the counter-step\'s issuance window is anchored at c_A — c_B at T0, c_A at T0+9 min: issued and accepted at T0+24h15m, refused past c_A + 24h10m; the edge follows what was issued and received (met, outgoing, mutual)', async () => {
  const A = await person(0xef), B = await person(0xf0)
  const card = await shownCard(B, T0)
  const sc = await A.h.scan(card, opts(T0 + 9 * M))
  await B.h.receive(sc.outbound[0].envelope, T0 + 9 * M + 1000)
  const [b] = await B.h.contacts()
  const ctr = await B.h.counter(b.id, opts(T0 + 24 * H + 15 * M))
  assert.equal(ctr.ok, true, JSON.stringify(ctr))
  assert.deepEqual(ev(await A.h.receive(ctr.outbound[0].envelope, T0 + 24 * H + 16 * M), 'encounter.accepted').map((e) => e.mutual), [true])
  const A2 = await person(0xf1), B2 = await person(0xf2)
  const card2 = await shownCard(B2, T0)
  const sc2 = await A2.h.scan(card2, opts(T0 + 9 * M))
  await B2.h.receive(sc2.outbound[0].envelope, T0 + 9 * M + 1000)
  const [b2] = await B2.h.contacts()
  assert.deepEqual(await B2.h.counter(b2.id, opts(T0 + 24 * H + 20 * M)), { ok: false, code: 'stale-issuance', ref: 'RLTP-ENC-5530' })
  // direction: optical record met → own credential outgoing → received mutual
  const A3 = await person(0xf3), B3 = await person(0xf4)
  const s3 = await scanned(A3, B3)
  assert.equal((await A3.h.contacts())[0].verification, 'outgoing')
  await B3.h.captureSentCard(ev(s3.sc, 'encounter.scanned')[0].card, opts(T0 + 1500))
  assert.equal((await B3.h.contacts())[0].verification, 'met')
  assert.equal((await B3.h.counter((await B3.h.contacts())[0].id, opts(T0 + 1600))).ok, true)
  assert.equal((await B3.h.contacts())[0].verification, 'outgoing')
  await B3.h.receive(s3.bundle.envelope, T0 + 2000)
  assert.equal((await B3.h.contacts())[0].verification, 'mutual')
})
