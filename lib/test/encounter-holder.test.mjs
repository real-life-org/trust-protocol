#!/usr/bin/env node
// encounter-holder (lib Stage 2, PR 7a): the Encounter ceremony graduated
// onto HolderState (encounter/ceremony.ts) — show, scan, the bundle, the
// confirm prompt, the counter-step, both paths of 5.8, restarts,
// duplicates, forged cards, aging challenges, the signed ack — and the
// graduated chain (trust act, star) on ceremony-born tuples.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { seedKeys, digestBytes, digestBytes as dB, labeledContext, diSign, diSignWith, diVerify, createHolder, jcs, seal, unseal, cardBody, credentialBody, binding, CEREMONY, iso as isoOf, issueCredential, signCard } from '../dist/index.js'
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
  assert.equal((await B.read()).encounter.challenges[card.challenge.value], undefined, 'the refusal latched the aged value (5260)')
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

test('encounter: the aging latch holds against a clock that moves back — a bundle refused at T0+20min stays refused at T0+2min, after a restart too; the optical leg latches the same way (5260, 5270, 5290)', async () => {
  const A = await person(0x5a), B = await person(0x5b)
  const { bundle } = await scanned(A, B)
  const s0 = await B.read()
  const r1 = await B.h.receive(bundle.envelope, T0 + 20 * 60_000)
  assert.deepEqual([r1.disposition, r1.reason, r1.stage, r1.ref], ['failed', 'validation-failed', 9, 'RLTP-ENC-5240'])
  const s1 = await B.read()
  assert.deepEqual(s1.encounter.challenges, {}, 'the latch committed')
  assert.equal(s1.lastWhen, T0 + 20 * 60_000)
  assert.equal(Object.keys(s1.effects).length, Object.keys(s0.effects).length, 'no cache entry')
  assert.equal(BigInt(s1.commitSeq), BigInt(s0.commitSeq) + 1n, 'one commit: the latch alone')
  const r2 = await B.h.receive(bundle.envelope, T0 + 2 * 60_000)
  assert.deepEqual([r2.disposition, r2.reason], ['failed', 'validation-failed'], 'the clock moved back: still refused')
  B.h = await createHolder({ store: B.store, keys: B.keys }, { invariants: true })
  const r3 = await B.h.receive(bundle.envelope, T0 + 2 * 60_000)
  assert.deepEqual([r3.disposition, r3.reason], ['failed', 'validation-failed'], 'after a restart: still refused')
  assert.deepEqual(await B.h.contacts(), [])
  // the optical leg
  const C = await person(0x5c), D = await person(0x5d)
  const { sc } = await scanned(C, D)
  const sent = ev(sc, 'encounter.scanned')[0].card
  assert.deepEqual(await D.h.captureSentCard(sent, opts(T0 + 20 * 60_000)), { ok: false, code: 'gate-expired', ref: 'RLTP-ENC-5460' })
  assert.deepEqual((await D.read()).encounter.challenges, {}, 'the refusal latched')
  assert.deepEqual(await D.h.captureSentCard(sent, opts(T0 + 2 * 60_000)), { ok: false, code: 'gate-expired', ref: 'RLTP-ENC-5460' })
  assert.deepEqual(await D.h.contacts(), [])
})

// ── 5170 on both sides; checks 5–6 at stage 8 ──────────────────────────


/** A scanner's material crafted outside a holder: a fresh pair context
 *  of `seed`, a sent card bound to `toCard`'s challenge with `ownValue`, a
 *  credential with `bind` (default: the true binding), sealed as a bundle. */
async function craft (seed, nonceFill, toCard, ownValue, { bind, validFrom, when = T0 + 1000 } = {}) {
  const ctx = await labeledContext(seed, 'pair/' + await dB(new Uint8Array(32).fill(nonceFill)))
  const at = isoOf(when)
  const sent = await diSign(ctx, cardBody(ctx, { challenge: { value: ownValue, issuedAt: at }, sentTo: toCard.anchor, boundTo: toCard.challenge.value }), at)
  const b = bind ?? await binding(CEREMONY, ownValue, toCard.challenge.value)
  const credential = await diSign(ctx, credentialBody(ctx.anchor, toCard.anchor, CEREMONY, toCard.challenge.value, b, validFrom ?? at), validFrom ?? at)
  const doc = { id: randomUUID(), type: BUNDLE, issuer: ctx.anchor, recipient: toCard.anchor, threadId: randomUUID(), issuedAt: at, payload: { card: sent, credential } }
  return { sent, envelope: await seal(doc, toCard.keyAgreement) }
}

test('encounter: 5170 on both sides — a challenge value in any record or among the own open challenges enters no new enactment: scanner, optical leg and bundle', async () => {
  const A = await person(0x5e), B = await person(0x5f)
  const { card } = await scanned(A, B)
  const recA = Object.values((await A.read()).encounter.records)[0]
  // the scanner: a displayed card whose challenge is a value of A's record (its own c_A), whatever its anchor
  const other = await labeledContext(new Uint8Array(64).fill(0x60), 'pair/' + await dB(new Uint8Array(32).fill(1)))
  const at = isoOf(T0 + 2000)
  const echo = await diSign(other, cardBody(other, { challenge: { value: recA.own, issuedAt: at } }), at)
  assert.deepEqual(await A.h.scan(echo, opts(T0 + 2000)), { ok: false, code: 'already-scanned', ref: 'RLTP-ENC-5170' })
  // the displayer: B shows two more codes; a sent card for the second that reuses the first's c_A
  await B.h.receive((await A.read()).outbox[Object.keys((await A.read()).outbox)[0]].envelope, T0 + 2000)
  const recB = Object.values((await B.read()).encounter.records)[0]
  const second = ev(await B.h.show(opts(T0 + 3000)), 'encounter.shown')[0].card
  const third = ev(await B.h.show(opts(T0 + 3001)), 'encounter.shown')[0].card
  const reused = await craft(new Uint8Array(64).fill(0x61), 2, second, recB.peer, { when: T0 + 4000 })
  assert.deepEqual(await B.h.captureSentCard(reused.sent, opts(T0 + 4000)), { ok: false, code: 'consumed-challenge', ref: 'RLTP-ENC-5170' })
  const r = await B.h.receive(reused.envelope, T0 + 4000)
  assert.deepEqual([r.disposition, r.reason, r.ref], ['failed', 'validation-failed', 'RLTP-ENC-5170'])
  // c_A equal to one of B's own open challenges
  const mirrored = await craft(new Uint8Array(64).fill(0x62), 3, second, third.challenge.value, { when: T0 + 4000 })
  assert.deepEqual([(await B.h.receive(mirrored.envelope, T0 + 4000)).ref], ['RLTP-ENC-5170'])
  assert.equal(Object.keys((await B.read()).encounter.records).length, 1)
  void card
})

test('encounter: a bundle failing checks 5–6 on an open challenge is refused at stage 8 — the enactment binding (5560), the issuance window (5530)', async () => {
  const B = await person(0x63)
  const card = ev(await B.h.show(opts(T0)), 'encounter.shown')[0].card
  const wrong = await craft(new Uint8Array(64).fill(0x64), 4, card, 'wrongbindingvalue12345', { bind: await binding(CEREMONY, 'x'.repeat(22), 'y'.repeat(22)) })
  const r1 = await B.h.receive(wrong.envelope, T0 + 1000)
  assert.deepEqual([r1.disposition, r1.reason, r1.stage, r1.ref], ['failed', 'validation-failed', 8, 'RLTP-ENC-5560'])
  const stale = await craft(new Uint8Array(64).fill(0x65), 5, card, 'stalewindowvalue123456', { validFrom: isoOf(T0 - 3_600_000) })
  const r2 = await B.h.receive(stale.envelope, T0 + 1000)
  assert.deepEqual([r2.disposition, r2.reason, r2.stage, r2.ref], ['failed', 'stale-issuance', 8, 'RLTP-ENC-5530'])
  assert.ok((await B.read()).encounter.challenges[card.challenge.value], 'nothing consumed')
})

// ── ported from the probe's encounter suite (lib Stage 2, PR 7b) ────────

test('encounter: uniqueness (5.6 step 8) — the same credential in a new document is taken idempotently; a re-proofed copy is acknowledged like any delivery (4.3) but never accepted: the first credential stands', async () => {
  const A = await person(0x51), B = await person(0x52)
  const { bundle } = await scanned(A, B)
  await B.h.receive(bundle.envelope, T0 + 2000)
  const [prompt] = await B.h.prompts()
  const d = await B.h.decide(prompt.id, 'accept', opts(T0 + 3000))
  const counter = d.outbound.find((o) => o.type === DELIVERY)
  assert.equal((await A.h.receive(counter.envelope, T0 + 4000)).disposition, 'unique')
  const [recA] = Object.values((await A.read()).encounter.records)
  const ownA = await labeledContext(A.seed, recA.label)
  const doc = (await unseal(counter.envelope, ownA.x.priv)).document
  const again = await A.h.receive(await seal({ ...doc, id: randomUUID() }, ownA.keyAgreement), T0 + 5000)
  assert.equal(again.disposition, 'unique', 'an equal credential digest is idempotent')
  assert.equal(again.outbound[0]?.type, ACK, 'and acknowledged')
  const [recB] = Object.values((await B.read()).encounter.records)
  const ownB = await labeledContext(B.seed, recB.label)
  const re = await issueCredential(ownB, recB.counterpart, CEREMONY, recB.peer, recB.bind, isoOf(T0 + 6000))
  const conflict = await A.h.receive(await seal({ ...doc, id: randomUUID(), payload: { ...doc.payload, credential: re } }, ownA.keyAgreement), T0 + 7000)
  assert.equal(conflict.disposition, 'unique', JSON.stringify(conflict))
  assert.equal(conflict.outbound[0]?.type, ACK, 'acknowledged at arrival (4.3)')
  assert.deepEqual(ev(conflict, 'encounter.accepted'), [], 'never signaled as an acceptance')
  assert.deepEqual(Object.values((await A.read()).encounter.records)[0].in, recA.in, 'the first accepted credential stands')
})

test('encounter: a sent card whose own challenge equals the displayed one is refused on the optical leg (5160)', async () => {
  const A = await person(0x53), B = await person(0x54)
  const { card, sc } = await scanned(A, B)
  const sent = ev(sc, 'encounter.scanned')[0].card
  const [recA] = Object.values((await A.read()).encounter.records)
  const ownA = await labeledContext(A.seed, recA.label)
  const { proof, ...body } = sent
  const reused = await signCard(ownA, { ...body, challenge: { value: card.challenge.value, issuedAt: body.challenge.issuedAt } }, proof.created)
  assert.deepEqual(await B.h.captureSentCard(reused, opts(T0 + 2000)), { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-5160' })
  assert.deepEqual((await B.read()).encounter.records, {}, 'nothing recorded')
  assert.ok((await B.read()).encounter.challenges[card.challenge.value], 'the displayed challenge stays open')
})
