#!/usr/bin/env node
// encounter-holder (lib Stage 2, PR 7a): the Encounter ceremony graduated
// onto HolderState (encounter/ceremony.ts) — show, scan, the bundle, the
// confirm prompt, the counter-step, both paths of 5.8, restarts,
// duplicates, forged cards, aging challenges, the signed ack — and the
// graduated chain (trust act, star) on ceremony-born tuples.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { seedKeys, digestBytes, labeledContext, diSign, diSignWith, diVerify, createHolder, jcs, seal, unseal } from '../dist/index.js'
import { T0, BUNDLE, DELIVERY, ACK, person, ev, opts, scanned, settle, met, communityPerson } from './holder-fixture.mjs'

test('crypto: diSignWith over the KeyProvider is byte-identical to diSign over the private key', async () => {
  const seed = new Uint8Array(64).fill(0x31)
  const keys = seedKeys(seed)
  const label = 'pair/' + await digestBytes(new Uint8Array(32).fill(7))
  const ctx = await labeledContext(seed, label)
  const doc = { '@context': ['https://www.w3.org/ns/credentials/v2'], hello: 'world', n: 1 }
  const created = '2026-10-15T09:00:00Z'
  const a = await diSign(ctx, doc, created)
  const b = await diSignWith(ctx.anchor, (bytes) => keys.sign(label, bytes), doc, created)
  assert.deepEqual(b, a)
  assert.equal(await diVerify(b, ctx.anchor), true)
  await assert.rejects(diSignWith(ctx.anchor, async () => new Uint8Array(63), doc, created), /64-byte/)
  assert.ok(T0)
})

// ── two holders meet ───────────────────────────────────────────────────

test('encounter: show → scan → bundle → confirm prompt → counter-step → mutual, with signed acks both ways', async () => {
  const A = await person(0x41), B = await person(0x42)
  const { card, sc, bundle } = await scanned(A, B)
  // the displayed card: a fresh pair anchor in the register before display, lastShown set
  const sB0 = await B.read()
  const ch = sB0.encounter.challenges[card.challenge.value]
  assert.ok(ch && sB0.register.labels.includes(ch.label) && sB0.register.pairNonces[ch.label])
  assert.equal(sB0.addresses.keys[card.keyAgreement].lastShown, T0)
  // the scanner: record, fresh tuple, bundle in the outbox, the sent card for the optical leg
  assert.deepEqual(sc.events.map((e) => e.type), ['contact.added', 'encounter.recorded', 'encounter.scanned'])
  const sA = await A.read()
  const [recA] = Object.values(sA.encounter.records)
  assert.equal(recA.role, 'scanner')
  assert.equal(recA.peer, card.challenge.value)
  assert.ok(recA.out && recA.in === null)
  assert.equal(sA.outbox[bundle.digest].type, BUNDLE)
  assert.ok(Object.values(sA.duties).some((d) => d.kind === 'continuity' && d.step === 'probe'), 'the fresh tuple owes its continuity probe (6820)')
  // the displayer receives the bundle: record-creating effect, prompt, signed ack
  const got = await B.h.receive(bundle.envelope, T0 + 2000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  assert.deepEqual(got.events.map((e) => e.type), ['contact.added', 'encounter.recorded', 'encounter.accepted', 'prompt.opened'])
  const ack = got.outbound[0]
  assert.equal(ack.type, ACK)
  const sB = await B.read()
  assert.deepEqual(sB.encounter.challenges, {}, 'open → recorded (5220)')
  const [recB] = Object.values(sB.encounter.records)
  assert.equal(recB.role, 'displayer')
  assert.ok(recB.in && recB.out === null)
  const [prompt] = await B.h.prompts()
  assert.equal(prompt.kind, 'encounter-confirm')
  // arrival, not acceptance: A's bundle is delivered by the signed ack only
  assert.equal((await A.h.receive(ack.envelope, T0 + 3000)).disposition, 'unique')
  assert.equal((await A.h.deliveryStatus(bundle.digest)).items[0].status, 'delivered')
  // B confirms: the counter-step in the bundle's thread
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 4000))
  assert.equal(d.ok, true, JSON.stringify(d))
  const counter = d.outbound.find((o) => o.type === DELIVERY)
  assert.equal(counter.threadId, bundle.threadId, 'counter continues the bundle thread (5760)')
  const got2 = await A.h.receive(counter.envelope, T0 + 5000)
  assert.equal(got2.disposition, 'unique', JSON.stringify(got2))
  assert.deepEqual(ev(got2, 'encounter.accepted').map((e) => e.mutual), [true])
  assert.equal((await B.h.receive(got2.outbound[0].envelope, T0 + 6000)).disposition, 'unique')
  assert.deepEqual(await B.h.prompts(), [])
  const sA2 = await A.read(), sB2 = await B.read()
  assert.ok(Object.values(sA2.encounter.records)[0].in && Object.values(sB2.encounter.records)[0].out)
})

test('encounter: the views — a ceremony-born contact, displayName from the card, the edge from the credentials (outgoing, incoming, mutual)', async () => {
  const A = await person(0x43), B = await person(0x44)
  const { bundle } = await scanned(A, B)
  let [a] = await A.h.contacts()
  assert.deepEqual([a.displayName, a.provenance, a.verification], ['Bea', 'ceremony', 'outgoing'])
  const got = await B.h.receive(bundle.envelope, T0 + 2000)
  let [b] = await B.h.contacts()
  assert.deepEqual([b.displayName, b.provenance, b.verification], ['Al', 'ceremony', 'incoming'])
  const [prompt] = await B.h.prompts()
  assert.equal(prompt.contactId, b.id)
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 3000))
  ;[b] = await B.h.contacts()
  assert.equal(b.verification, 'mutual', 'issued and accepted')
  await settle([A, B], [...got.outbound, ...d.outbound], T0 + 4000)
  ;[a] = await A.h.contacts()
  assert.equal(a.verification, 'mutual')
  assert.equal(a.trust.received, false, 'trust is a separate act (Encounter 3)')
})

test('encounter: decline closes the confirm prompt; the edge stays one-sided, a legitimate outcome (5750)', async () => {
  const A = await person(0x45), B = await person(0x46)
  const { bundle } = await scanned(A, B)
  await B.h.receive(bundle.envelope, T0 + 2000)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'decline', opts(T0 + 3000))
  assert.deepEqual(d.outbound, [])
  assert.deepEqual(await B.h.prompts(), [])
  assert.equal((await B.h.contacts())[0].verification, 'incoming')
  // the counter-step stays possible later, unbounded in time within its window (5750)
  const c = await B.h.counter((await B.h.contacts())[0].id, opts(T0 + 60_000))
  assert.equal(c.ok, true)
  assert.equal(c.outbound[0].type, DELIVERY)
  assert.deepEqual(await B.h.counter((await B.h.contacts())[0].id, opts(T0 + 61_000)), { ok: false, code: 'already-issued' })
})

// ── 5.8: the offline path and free switching ───────────────────────────

test('encounter: the offline path — the sent card captured optically creates the record; the counter credential waits for the bundle thread; the bundle lands record-aware and carries the counter-step out (5.8, 5740, 5780)', async () => {
  const A = await person(0x47), B = await person(0x48)
  const { sc, bundle } = await scanned(A, B)
  const sent = ev(sc, 'encounter.scanned')[0].card
  assert.equal(sent.sentTo !== undefined && sent.boundTo !== undefined, true)
  // B captures the sent card: the record, the tuple, the prompt; no credential yet
  const cap = await B.h.captureSentCard(sent, opts(T0 + 1500))
  assert.equal(cap.ok, true, JSON.stringify(cap))
  assert.deepEqual(cap.events.map((e) => e.type), ['contact.added', 'encounter.recorded', 'prompt.opened'])
  let [b] = await B.h.contacts()
  assert.equal(b.verification, 'met', 'a record alone has no direction (4.2): held as outgoing at most once B issues (5720)')
  // a re-scan of the same card is an idempotent no-op (5430)
  const again = await B.h.captureSentCard(sent, opts(T0 + 1600))
  assert.equal(again.ok, true)
  assert.deepEqual(again.events, [])
  // B confirms at once: the credential is issued and held; its document waits (5770, 5780)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 1700))
  assert.equal(d.ok, true, JSON.stringify(d))
  assert.deepEqual(d.outbound, [], 'no thread of its own (5780)')
  assert.equal(Object.values((await B.read()).encounter.records)[0].counterPending, true)
  // the bundle arrives later: accepted via the record, and the counter document goes out in its thread
  const got = await B.h.receive(bundle.envelope, T0 + 60_000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  const counter = got.outbound.find((o) => o.type === DELIVERY)
  assert.ok(counter, 'the waiting counter-step document')
  assert.equal(counter.threadId, bundle.threadId)
  assert.deepEqual(ev(got, 'encounter.accepted').map((e) => e.mutual), [true])
  ;[b] = await B.h.contacts()
  assert.equal(b.verification, 'mutual')
  await settle([A, B], got.outbound, T0 + 61_000)
  assert.equal((await A.h.contacts())[0].verification, 'mutual')
  assert.equal(Object.keys((await B.read()).encounter.records).length, 1, 'one record, no second enactment (5610)')
})

test('encounter: the switch the other way — the bundle first, then the same sent card optically is an idempotent no-op; a second scanner on the consumed challenge is refused (5430, 5440)', async () => {
  const A = await person(0x49), B = await person(0x4a), C = await person(0x4b)
  const shown = await B.h.show(opts(T0, { name: 'Bea' }))
  const card = ev(shown, 'encounter.shown')[0].card
  const sa = await A.h.scan(card, opts(T0 + 1000))
  const sc = await C.h.scan(card, opts(T0 + 1100))
  assert.equal(sc.ok, true, 'C cannot know the code is taken')
  assert.equal((await B.h.receive(sa.outbound[0].envelope, T0 + 2000)).disposition, 'unique')
  assert.equal((await B.h.captureSentCard(ev(sa, 'encounter.scanned')[0].card, opts(T0 + 2100))).ok, true)
  assert.deepEqual(await B.h.captureSentCard(ev(sc, 'encounter.scanned')[0].card, opts(T0 + 2200)), { ok: false, code: 'consumed-challenge', ref: 'RLTP-ENC-5440' })
  const r = await B.h.receive(sc.outbound[0].envelope, T0 + 2300)
  assert.deepEqual([r.disposition, r.reason, r.stage, r.ref], ['failed', 'consumed-challenge', 9, 'RLTP-ENC-5440'])
  assert.equal((await B.h.contacts()).length, 1)
})

/** Open an envelope sealed to an own pair label of a person. */
async function openWith (P, label, env) {
  const ctx = await labeledContext(P.seed, label)
  const r = await unseal(env, ctx.x.priv)
  if (r.error) throw new Error('openWith: ' + r.error)
  return r.document
}

test('encounter: forged cards — a scanned card with a broken proof is card-invalid; a bundle with a tampered card fails its proof; a re-signed card unlike the recorded one is refused (6020, 5730)', async () => {
  const A = await person(0x4c), B = await person(0x4d)
  const shown = await B.h.show(opts(T0))
  const card = ev(shown, 'encounter.shown')[0].card
  assert.deepEqual(await A.h.scan({ ...card, name: 'Mallory' }, opts(T0 + 500)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6010' })
  const first = await A.h.scan(card, opts(T0 + 1000, { name: 'one' }))
  const sent = ev(first, 'encounter.scanned')[0].card
  assert.equal((await B.h.captureSentCard(sent, opts(T0 + 1100))).ok, true)
  assert.deepEqual(await A.h.scan(card, opts(T0 + 1200)), { ok: false, code: 'already-scanned', ref: 'RLTP-ENC-5170' })
  // the genuine bundle, opened at B's display key and altered
  const label = (await B.read()).addresses.keys[card.keyAgreement].label
  const doc = await openWith(B, label, first.outbound[0].envelope)
  const tampered = { ...doc, id: randomUUID(), payload: { ...doc.payload, card: { ...doc.payload.card, name: 'two' } } }
  const r1 = await B.h.receive(await seal(tampered, card.keyAgreement), T0 + 1300)
  assert.deepEqual([r1.disposition, r1.reason, r1.stage], ['failed', 'validation-failed', 8])
  // re-signed by A's own key: a valid card, but not the one recorded optically
  const aLabel = Object.values((await A.read()).encounter.records)[0].label
  const actx = await labeledContext(A.seed, aLabel)
  const { proof: _, ...body } = doc.payload.card
  const resigned = await diSign(actx, { ...body, name: 'two' }, body.challenge.issuedAt)
  const swapped = { ...doc, id: randomUUID(), threadId: randomUUID(), payload: { ...doc.payload, card: resigned } }
  const r2 = await B.h.receive(await seal(swapped, card.keyAgreement), T0 + 1400)
  assert.deepEqual([r2.disposition, r2.reason, r2.ref], ['failed', 'validation-failed', 'RLTP-ENC-5730'])
  assert.equal(Object.values((await B.read()).encounter.records)[0].in, null, 'nothing accepted')
  // the genuine bundle still lands record-aware
  assert.equal((await B.h.receive(first.outbound[0].envelope, T0 + 1500)).disposition, 'unique')
  assert.ok(Object.values((await B.read()).encounter.records)[0].in)
})

// ── restarts, duplicates, aging ────────────────────────────────────────

test('encounter: restart mid-ceremony — the scanner restarts before sending, resume re-emits the bundle; the displayer restarts before its ack, resume re-offers it; the prompt survives', async () => {
  const A = await person(0x50), B = await person(0x51)
  const { bundle } = await scanned(A, B)
  A.h = await createHolder({ store: A.store, keys: A.keys }, { invariants: true })
  const re = await A.h.resume(T0 + 40_000)
  const again = re.outbound.find((o) => o.digest === bundle.digest)
  assert.ok(again && again.attempt === 2, 'byte-identical re-emission from the outbox')
  assert.equal(jcs(again.envelope), jcs(bundle.envelope))
  const got = await B.h.receive(again.envelope, T0 + 41_000)
  assert.equal(got.disposition, 'unique')
  B.h = await createHolder({ store: B.store, keys: B.keys }, { invariants: true })
  const ack = (await B.h.resume(T0 + 90_000)).outbound.find((o) => o.type === ACK)
  assert.equal(jcs(ack.envelope), jcs(got.outbound[0].envelope), 'the stored ack, byte-identical')
  assert.equal((await A.h.receive(ack.envelope, T0 + 91_000)).disposition, 'unique')
  const [prompt] = await B.h.prompts()
  assert.equal((await B.h.decide(prompt.id, 'accept', opts(T0 + 92_000))).ok, true)
})

test('encounter: a duplicate bundle is duplicate-known with the stored ack; after the cache\'s retention the same bundle lands record-aware and earns a fresh ack (4.2)', async () => {
  const A = await person(0x52), B = await person(0x53)
  const { bundle } = await scanned(A, B)
  const one = await B.h.receive(bundle.envelope, T0 + 2000)
  const two = await B.h.receive(bundle.envelope, T0 + 3000)
  assert.equal(two.disposition, 'duplicate-known')
  assert.equal(jcs(two.outbound[0].envelope), jcs(one.outbound[0].envelope))
  const late = T0 + 91 * 86_400_000
  await B.h.tick(late)
  const three = await B.h.receive(bundle.envelope, late + 1)
  assert.equal(three.disposition, 'unique', JSON.stringify(three))
  assert.deepEqual(three.events, [], 'idempotent: the credential was accepted already (5.6 step 8)')
  assert.notEqual(jcs(three.outbound[0].envelope), jcs(one.outbound[0].envelope))
  assert.equal(Object.keys((await B.read()).encounter.records).length, 1)
})

test('encounter: an aged challenge — a late bundle is validation-failed, a late optical card gate-expired; tick removes the aged value; a scan past the issuance window is stale-issuance (5.3, 5460, 5.6 step 6)', async () => {
  const A = await person(0x54), B = await person(0x55)
  const { sc, bundle, card } = await scanned(A, B)
  const late = T0 + 11 * 60_000
  const r = await B.h.receive(bundle.envelope, late)
  assert.deepEqual([r.disposition, r.reason, r.stage, r.ref], ['failed', 'validation-failed', 9, 'RLTP-ENC-5240'])
  assert.deepEqual(await B.h.captureSentCard(ev(sc, 'encounter.scanned')[0].card, opts(late + 1)), { ok: false, code: 'gate-expired', ref: 'RLTP-ENC-5460' })
  assert.ok((await B.read()).encounter.challenges[card.challenge.value], 'a refusal commits nothing')
  await B.h.tick(late + 2)
  assert.deepEqual((await B.read()).encounter.challenges, {}, 'aged values are not kept (5230)')
  assert.deepEqual(await B.h.contacts(), [])
  // the scanner: c_B issued more than max-age + issuance-window + skew ago
  const C = await person(0x56)
  const far = T0 + 5 * 60_000 + 24 * 3_600_000 + 5 * 60_000 + 2000
  assert.deepEqual(await C.h.scan(card, opts(far)), { ok: false, code: 'stale-issuance', ref: 'RLTP-ENC-5530' })
})

// ── the graduated chain on ceremony-born tuples ────────────────────────


test('encounter: the graduated chain on ceremony-born tuples — the continuity probes cross, the trust act gives both mappings, the star reaches the counterpart', async () => {
  const A = await communityPerson(0x57), B = await communityPerson(0x58)
  const { a, b } = await met(A, B)
  assert.equal(a.verification, 'mutual')
  // the continuity probe of each fresh tuple went out and completed (6820, 6830)
  const probesDone = async (P) => Object.values((await P.read()).relationships).flatMap((r) => r.tuples).every((t) => t.probeOut.done)
  assert.equal(await probesDone(A), true)
  assert.equal(await probesDone(B), true)
  const ta = await A.h.trust(a.id, opts(T0 + 5000))
  const tb = await B.h.trust(b.id, opts(T0 + 5000))
  const results = await settle([A, B], [...ta.outbound, ...tb.outbound], T0 + 6000)
  const [a2] = await A.h.contacts(), [b2] = await B.h.contacts()
  assert.deepEqual([a2.trust.given, a2.trust.received, b2.trust.given, b2.trust.received], [true, true, true, true])
  assert.ok(results.some((x) => x.got.events?.some((e) => e.type === 'star.accepted')), 'a star completed on a ceremony-born tuple')
})
