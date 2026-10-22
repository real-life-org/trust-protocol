#!/usr/bin/env node
// delivery-hints: the carrier offer of show and scan (Encounter
// RLTP-ENC-6080, 6090; Identity §7a.3; VTI mediator adapter profile §1b).
// The app hands the act the relationship's carrier nonce N and the hints
// it built from it; the library signs the hints into the card, records N
// in the register under the relationship the card opens, refuses what
// breaks 6090 or reuses a nonce, never interprets a hint, and shows the
// counterpart's first-contact hints and the own N in the contact view.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { b64uOf, cardOk } from '../dist/index.js'
import { decodeState, encodeState, sameState } from '../dist/internal.js'
import { T0, BUNDLE, person, ev, opts, settle, communityPerson } from './holder-fixture.mjs'

const VEC = JSON.parse(readFileSync(new URL('../../vectors/vti-delivery-hints.json', import.meta.url), 'utf8'))
const HINT_A = VEC.hints.A
const HINT_B = VEC.hints.B
const nonce = (fill) => new Uint8Array(32).fill(fill)
const offer = (fill, deliveryHints) => ({ nonce: nonce(fill), deliveryHints })
const relOfLabel = (label) => 'r-' + label.slice('pair/'.length)

/** B shows a card offering `showHints` under N = fill sB; A scans it offering `scanHints` under fill sA. */
async function meetWithHints (A, B, t, { sB = 0xb1, sA = 0xa1, showHints = [HINT_B], scanHints = [HINT_A] } = {}) {
  const shown = await B.h.show(opts(t, { name: 'Bea', ...(showHints ? { carrier: offer(sB, showHints) } : {}) }))
  assert.equal(shown.ok, true, JSON.stringify(shown))
  const card = ev(shown, 'encounter.shown')[0].card
  const sc = await A.h.scan(card, opts(t + 1000, { name: 'Al', ...(scanHints ? { carrier: offer(sA, scanHints) } : {}) }))
  assert.equal(sc.ok, true, JSON.stringify(sc))
  return { card, sc, bundle: sc.outbound.find((o) => o.type === BUNDLE), sent: ev(sc, 'encounter.scanned')[0].card }
}

test('delivery hints: the vector — each hint is the JCS form of a TSPTransport service entry, at most 512 characters (RLTP-VTI-1210, RLTP-ENC-6090)', () => {
  for (const side of ['A', 'B']) {
    const h = VEC.hints[side]
    const o = JSON.parse(h)
    assert.deepEqual(Object.keys(o).sort(), ['id', 'rltpEgress', 'serviceEndpoint', 'type'])
    assert.equal(o.type, 'TSPTransport')
    assert.equal(o.id, VEC.sides[side].connection + '#tsp')
    assert.equal(o.rltpEgress, VEC.sides[side].egress)
    assert.equal(o.serviceEndpoint, VEC.carrier)
    assert.equal(h.length, VEC.hintLength[side])
    assert.ok([...h].length <= 512)
  }
})

test('delivery hints: show signs the hints into the displayed card and records N under the relationship the card opens; the card verifies', async () => {
  const B = await person(0x71)
  const shown = await B.h.show(opts(T0, { carrier: offer(0xb1, [HINT_B]) }))
  assert.equal(shown.ok, true, JSON.stringify(shown))
  const card = ev(shown, 'encounter.shown')[0].card
  assert.deepEqual(card.deliveryHints, [HINT_B])
  assert.equal(await cardOk(card), null, 'the hints are under the proof')
  const s = await B.read()
  const { label } = s.encounter.challenges[card.challenge.value]
  assert.deepEqual(s.register.carriers[relOfLabel(label)], [{ nonce: b64uOf(nonce(0xb1)), generation: '1' }])
  assert.deepEqual(Object.keys(s.register.carriers), [relOfLabel(label)], 'one entry, nothing else')
  // the codec round trip keeps the entry
  assert.ok(sameState(decodeState(encodeState(s)), s))
  // without an offer: no hints, no entry
  const plain = ev(await B.h.show(opts(T0 + 1)), 'encounter.shown')[0].card
  assert.equal(plain.deliveryHints, undefined)
  assert.deepEqual(Object.keys((await B.read()).register.carriers), [relOfLabel(label)])
})

test('delivery hints: the scanner\'s sent card carries its hints, N goes to the register; both sides read the counterpart\'s hints and their own N in the contact view (bundle path)', async () => {
  const A = await person(0x72), B = await person(0x73)
  const { card, bundle, sent } = await meetWithHints(A, B, T0)
  assert.deepEqual(sent.deliveryHints, [HINT_A])
  assert.equal(await cardOk(sent), null)
  const [a] = await A.h.contacts()
  assert.deepEqual(a.relationships, [{
    id: a.relationships[0].id, tuples: 1, chainedFrom: [],
    carrierNonce: { nonce: b64uOf(nonce(0xa1)), generation: '1' },
    counterpartDeliveryHints: [HINT_B],
  }])
  assert.deepEqual(card.deliveryHints, [HINT_B])
  const got = await B.h.receive(bundle.envelope, T0 + 2000)
  assert.equal(got.disposition, 'unique', JSON.stringify(got))
  const [b] = await B.h.contacts()
  assert.deepEqual(b.relationships, [{
    id: b.relationships[0].id, tuples: 1, chainedFrom: [],
    carrierNonce: { nonce: b64uOf(nonce(0xb1)), generation: '1' },
    counterpartDeliveryHints: [HINT_A],
  }])
})

test('delivery hints: the optical leg — the captured sent card gives the displayer the scanner\'s hints', async () => {
  const A = await person(0x74), B = await person(0x75)
  const { sent } = await meetWithHints(A, B, T0)
  const cap = await B.h.captureSentCard(sent, opts(T0 + 1500))
  assert.equal(cap.ok, true, JSON.stringify(cap))
  const [b] = await B.h.contacts()
  assert.deepEqual(b.relationships[0].counterpartDeliveryHints, [HINT_A])
  assert.deepEqual(b.relationships[0].carrierNonce, { nonce: b64uOf(nonce(0xb1)), generation: '1' })
})

test('delivery hints: RLTP-ENC-6090 — up to eight hints of up to 512 characters; more, longer or none is card-invalid, nothing commits', async () => {
  const B = await person(0x76)
  const ok8 = await B.h.show(opts(T0, { carrier: offer(1, Array.from({ length: 8 }, () => 'h'.repeat(512))) }))
  assert.equal(ok8.ok, true, JSON.stringify(ok8))
  assert.equal(ev(ok8, 'encounter.shown')[0].card.deliveryHints.length, 8)
  const ok512 = await B.h.show(opts(T0 + 1, { carrier: offer(2, ['🌱'.repeat(512)]) }))
  assert.equal(ok512.ok, true, 'characters are code points')
  const before = await B.read()
  const refused = { ok: false, code: 'card-invalid', ref: 'RLTP-ENC-6090' }
  assert.deepEqual(await B.h.show(opts(T0 + 2, { carrier: offer(3, Array.from({ length: 9 }, () => 'h')) })), refused)
  assert.deepEqual(await B.h.show(opts(T0 + 3, { carrier: offer(4, ['h'.repeat(513)]) })), refused)
  assert.deepEqual(await B.h.show(opts(T0 + 4, { carrier: offer(5, []) })), refused)
  assert.deepEqual(await B.h.show(opts(T0 + 5, { carrier: offer(6, [42]) })), refused)
  // the scanner's sent card: the same bound
  const A = await person(0x77)
  const card = ev(await B.h.show(opts(T0 + 6)), 'encounter.shown')[0].card
  assert.deepEqual(await A.h.scan(card, opts(T0 + 7, { carrier: offer(7, ['h'.repeat(513)]) })), refused)
  assert.deepEqual((await A.read()).encounter.records, {})
  assert.equal((await B.read()).register.carriers[Object.keys(before.register.carriers)[0]].length, 1)
})

test('delivery hints: the carrier nonce is 32 bytes and fresh — another length, or a nonce the register already holds, is carrier-nonce-invalid (Identity §7a.3)', async () => {
  const A = await person(0x78), B = await person(0x79)
  const bad = { ok: false, code: 'carrier-nonce-invalid' }
  assert.deepEqual(await B.h.show(opts(T0, { carrier: { nonce: new Uint8Array(31), deliveryHints: [HINT_B] } })), bad)
  assert.deepEqual(await B.h.show(opts(T0 + 1, { carrier: { nonce: 'not bytes', deliveryHints: [HINT_B] } })), bad)
  assert.equal((await B.h.show(opts(T0 + 2, { carrier: offer(0x55, [HINT_B]) }))).ok, true)
  assert.deepEqual(await B.h.show(opts(T0 + 3, { carrier: offer(0x55, [HINT_B]) })), bad, 'reused on the same side')
  const card = ev(await B.h.show(opts(T0 + 4)), 'encounter.shown')[0].card
  assert.equal((await A.h.scan(card, opts(T0 + 5, { carrier: offer(0x56, [HINT_A]) }))).ok, true)
  const card2 = ev(await B.h.show(opts(T0 + 6)), 'encounter.shown')[0].card
  assert.deepEqual(await A.h.scan(card2, opts(T0 + 7, { carrier: offer(0x56, [HINT_A]) })), bad, 'reused by the scanner')
  // the generic act takes the canonical base64url form only
  const raw = await B.h.act('encounter.show', { carrier: { nonce: b64uOf(nonce(0x57)) + '=', deliveryHints: [HINT_B] } }, T0 + 8, { actId: 'raw-1' })
  assert.deepEqual(raw, bad)
})

test('delivery hints: the act is journaled with its offer — a repeat answers the same card, another nonce under the same actId is actid-conflict', async () => {
  const B = await person(0x7a)
  const o = opts(T0, { carrier: offer(0x31, [HINT_B]) })
  const first = await B.h.show(o)
  const again = await B.h.show({ ...o, carrier: offer(0x31, [HINT_B]) })
  assert.deepEqual(again.events, first.events)
  assert.deepEqual(await B.h.show({ ...o, carrier: offer(0x32, [HINT_B]) }), { ok: false, code: 'actid-conflict' })
  assert.equal(Object.keys((await B.read()).register.carriers).length, 1)
})

test('delivery hints: first contact only — a re-encounter chained into the relationship leaves its N and the counterpart\'s first hints in place (RLTP-VTI-1230)', async () => {
  const A = await communityPerson(0x7b), B = await communityPerson(0x7c)
  const first = await meetWithHints(A, B, T0)
  const got = await B.h.receive(first.bundle.envelope, T0 + 2000)
  const p1 = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d1 = await B.h.decide(p1.id, 'accept', opts(T0 + 3000))
  await settle([A, B], [...got.outbound, ...d1.outbound], T0 + 4000)
  // the re-encounter: other hints, other nonces
  const later = await meetWithHints(A, B, T0 + 100_000, { sB: 0xb2, sA: 0xa2, showHints: ['other-b'], scanHints: ['other-a'] })
  const got2 = await B.h.receive(later.bundle.envelope, T0 + 102_000)
  const p2 = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d2 = await B.h.decide(p2.id, 'accept', opts(T0 + 103_000))
  await settle([A, B], [...got2.outbound, ...d2.outbound], T0 + 104_000)
  for (const [P, own, peer] of [[A, 0xa1, HINT_B], [B, 0xb1, HINT_A]]) {
    const cs = await P.h.contacts()
    assert.equal(cs.length, 1, 'the re-encounter chained')
    const [rel] = cs[0].relationships
    assert.equal(rel.tuples, 2)
    assert.equal(rel.chainedFrom.length, 1)
    assert.deepEqual(rel.carrierNonce, { nonce: b64uOf(nonce(own)), generation: '1' }, 'the chain keeps its N')
    assert.deepEqual(rel.counterpartDeliveryHints, [peer], 'the first contact\'s hints stand')
    // the chained relationship: its N stays in the register, but the view lists it only in chainedFrom
    assert.equal(cs[0].relationships.length, 1)
    const husk = rel.chainedFrom[0]
    assert.equal((await P.read()).register.carriers[husk].length, 1, 'the re-encounter\'s N stays with the fresh relationship')
    assert.equal(cs[0].relationships.some((r) => r.id === husk), false, 'no RelationshipView, no carrierNonce for the chained relationship (RLTP-VTI-1230)')
  }
})

test('delivery hints: without an offer the relationship has neither N nor counterpart hints', async () => {
  const A = await person(0x7d), B = await person(0x7e)
  const { bundle } = await meetWithHints(A, B, T0, { showHints: null, scanHints: null })
  await B.h.receive(bundle.envelope, T0 + 2000)
  for (const P of [A, B]) {
    const [c] = await P.h.contacts()
    assert.deepEqual(c.relationships, [{ id: c.relationships[0].id, tuples: 1, chainedFrom: [] }])
    assert.deepEqual((await P.read()).register.carriers, {})
  }
})

test('delivery hints: the carrier nonce is never a pair nonce the register holds (Identity §7a.3)', async () => {
  const B = await person(0x7f)
  assert.equal((await B.h.show(opts(T0))).ok, true)
  const [pair] = Object.values((await B.read()).register.pairNonces)
  const asBytes = Uint8Array.from(Buffer.from(pair, 'base64url'))
  assert.deepEqual(await B.h.show(opts(T0 + 1, { carrier: { nonce: asBytes, deliveryHints: [HINT_B] } })), { ok: false, code: 'carrier-nonce-invalid' })
  assert.deepEqual((await B.read()).register.carriers, {})
})

// ── the adapter module builds and reads the hint (profile §1b) ─────────

test('adapter: deliveryHint derives the identities from (root, C, N) itself and gives the vector\'s hint (RLTP-VTI-1210, 1215)', async () => {
  const { deliveryHint } = await import('../dist/adapters/vti-mediator.js')
  const ID = JSON.parse(readFileSync(new URL('../../vectors/identity-derivation.json', import.meta.url), 'utf8'))
  const hex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)))
  const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  assert.equal(await deliveryHint(hex(ID.rootIkm), VEC.carrier, hex(ID.carrierRelationship.relationshipNonce)), VEC.hints.A)
  assert.equal(await deliveryHint(await sha('rltp/vector/vti-routed/root-B'), VEC.carrier, await sha('rltp/vector/vti-routed/nonce-B')), VEC.hints.B)
  await assert.rejects(deliveryHint(hex(ID.rootIkm), VEC.carrier, new Uint8Array(31)), /32 bytes/)
  // R8-B2: the inputs are snapshotted at entry — a buffer changed after the call, before the await, changes nothing
  const root = hex(ID.rootIkm), n = hex(ID.carrierRelationship.relationshipNonce)
  const pending = deliveryHint(root, VEC.carrier, n)
  n.fill(7); root.fill(7)
  assert.equal(await pending, VEC.hints.A, 'connection DID and egress identity from the same (root, C, N)')
  await assert.rejects(deliveryHint(hex(ID.rootIkm), '', hex(ID.carrierRelationship.relationshipNonce)), /carrier/)
})

test('adapter: readDeliveryHint reads the vector\'s hints and ignores every ignored case; readDeliveryHints applies 1225 to a card\'s list (RLTP-VTI-1220, 1225, 1240)', async () => {
  const { readDeliveryHint, readDeliveryHints } = await import('../dist/adapters/vti-mediator.js')
  for (const s of ['A', 'B']) {
    assert.deepEqual(readDeliveryHint(VEC.hints[s], VEC.carrier), { connectionDid: VEC.sides[s].connection, egressDid: VEC.sides[s].egress, carrier: VEC.carrier })
  }
  for (const c of VEC.ignored) assert.equal(readDeliveryHint(c.hint, VEC.carrier), null, c.case)
  for (const c of VEC.lists) {
    const want = c.expect === null ? null : { connectionDid: VEC.sides[c.expect].connection, egressDid: VEC.sides[c.expect].egress, carrier: VEC.carrier }
    assert.deepEqual(readDeliveryHints(c.hints, VEC.carrier), want, c.case)
  }
  assert.deepEqual(readDeliveryHints(VEC.card.deliveryHints, VEC.carrier)?.egressDid, VEC.sides.B.egress)
  assert.deepEqual(readDeliveryHints(VEC.sentCard.deliveryHints, VEC.carrier)?.egressDid, VEC.sides.A.egress)
  assert.equal(readDeliveryHints(undefined, VEC.carrier), null)
})

test('delivery hints: the vector\'s cards verify; a card with a hint over 512 characters fails the card schema (RLTP-ENC-6090)', async () => {
  assert.equal(await cardOk(VEC.card), null)
  assert.equal(await cardOk(VEC.sentCard), null)
  assert.match(await cardOk(VEC.tooLong.card), /schema/)
})

test('delivery hints: a relationship without hints at first contact stays without them — a chained re-encounter with hints changes nothing (RLTP-VTI-1230, 1235)', async () => {
  const A = await communityPerson(0x6b), B = await communityPerson(0x6c)
  const first = await meetWithHints(A, B, T0, { showHints: null, scanHints: null })
  const got = await B.h.receive(first.bundle.envelope, T0 + 2000)
  const p1 = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d1 = await B.h.decide(p1.id, 'accept', opts(T0 + 3000))
  await settle([A, B], [...got.outbound, ...d1.outbound], T0 + 4000)
  const later = await meetWithHints(A, B, T0 + 100_000, { sB: 0xb3, sA: 0xa3 })
  const got2 = await B.h.receive(later.bundle.envelope, T0 + 102_000)
  const p2 = (await B.h.prompts()).find((p) => p.kind === 'encounter-confirm')
  const d2 = await B.h.decide(p2.id, 'accept', opts(T0 + 103_000))
  await settle([A, B], [...got2.outbound, ...d2.outbound], T0 + 104_000)
  for (const P of [A, B]) {
    const cs = await P.h.contacts()
    assert.equal(cs.length, 1, 'the re-encounter chained')
    const [rel] = cs[0].relationships
    assert.equal(rel.tuples, 2)
    assert.equal(rel.carrierNonce, undefined)
    assert.equal(rel.counterpartDeliveryHints, undefined)
  }
})
