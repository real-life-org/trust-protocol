#!/usr/bin/env node
// HolderState codec (lib Stage 2, PR 1): the state is pure JSON under a
// codec version; decodeState validates by hand, rejects an unknown or
// higher codec and every invalid shape with a typed error, and lets
// duty kinds it does not know pass through unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODEC, decodeState, encodeState, sameState, StateCodecError, MIGRATIONS, isKnownDuty } from '../dist/internal.js'
import { jcs } from '../dist/index.js'
import { emptyState } from '../dist/testing.js'
import { decodeChain } from '../dist/codec.js'

const DK = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const KA = 'z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'          // counterpart key
const OWN = 'z6LSownOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwn'         // own rkid of the tuple
const D1 = 'uEiDYLnFbXqm2cwuJWuk9yNzRmlzWDpCTH6yA_4aP_1z_RA'

/** A state with every collection populated once. */
const fullState = () => {
  const s = emptyState(CODEC)
  s.commitSeq = '3'
  s.lastWhen = 1760000000000
  s.register.labels.push('pair/' + D1, 'group/' + D1)
  s.register.pairNonces['pair/' + D1] = 'AAAA'
  s.register.carriers.r1 = [{ nonce: 'AAAA', generation: '1' }]
  s.register.devices.names.push('laptop')
  s.register.community = { genesis: D1, head: '2' }
  s.register.lineage.push({ type: 'anchor-rotation@2', prev: DK, next: DK, proof: { proofValue: 'z' } })
  s.addresses.keys[KA] = { label: 'pair/' + D1, lastShown: 1760000000000 }
  s.addresses.tombstones.push('z6LSold')
  s.contacts.c1 = {
    id: 'c1', pos: '0', status: 'admitted', aliases: [], relIds: ['r1'], anchorHead: DK,
    settings: { star: 'default', groupStar: 'default', anchorMapping: 'on', sealedGroupStar: 'default', profile: 'off' },
    groupSettings: { [D1]: 'on' },
  }
  s.entryOrder = { nextPos: '1', heads: ['r1'] }
  s.relationships.r1 = {
    id: 'r1', contactId: 'c1', activeHead: 'pair/' + D1, earliestAnchor: null,
    links: [{ prev: DK, next: DK }], bindings: { [DK]: [D1] }, heldCounterpartHead: DK,
    memory: { name: 'Bo' }, provenance: { kind: 'ceremony', at: 1760000000000 }, chainedInto: null, firstVerified: null,
    tuples: [{
      ownPairLabel: 'pair/' + D1, counterpartAnchor: DK, counterpartKeyAgreement: KA, rkid: OWN, entryId: 'c1',
      priorCandidates: [{ ownPairLabel: 'pair/old', counterpartAnchor: DK }],
      starOut: { lastSalt: '2', exhausted: false, hwm: '1', snapshot: [{ member: 'c1', head: DK }], snapshotDigest: 'h1', inflight: { 2: { view: [{ member: 'c1', head: DK }], viewDigest: 'h1', digests: ['d'], acked: [] } } },
      starIn: { hwm: '0', lowerBound: '0', assembly: null, accepted: { salt: '1', blinded: ['b'], matches: ['c2'] } },
      groupStarOut: { lastSalt: '1', exhausted: false, hwm: '0', snapshot: null, snapshotDigest: null, inflight: { 1: { view: [{ group: D1, mode: 'digest' }, { group: 'uG2', mode: 'sealed', member: DK, memberOp: 'uOp' }], viewDigest: 'h2', digests: ['d'], acked: ['d'] } } },
      groupStarIn: { hwm: '0', lowerBound: '0', assembly: { salt: '2', chunks: { 0: { x: 1 } } }, accepted: { salt: '1', entries: [{ d: 'ud', c: 'uc' }], groups: ['ug'] } },
      probeOut: { seq: '0', inflight: {}, done: false }, probeIn: { hwm: '0', lowerBound: '0', assembly: null },
      continuityOut: { rev: '1', body: { prior: DK }, proof: null, sent: [], chosen: DK, reported: null, aligned: false, due: { kind: 'choice', prior: DK, alts: [] } },
      continuityIn: { rev: '1', body: { prior: DK }, recordPrior: DK },
      mappingOut: { rev: '0', body: null, underAnchor: null },
      mappingIn: { rev: '0', body: null, self: null, card: null },
      profileIn: { rev: '0', body: null, verifiedSeq: '0' },
      deactivated: false,
    }],
  }
  s.groups[D1] = { id: D1, memberLabel: 'pair/' + D1, rules: { vouchThreshold: '1' }, listed: true, membership: null, memberAnchor: DK, memberOp: 'oid:uOp' }
  s.profile = { body: { name: 'Al' }, revision: '1' }
  s.effects.uDigest = { ack: { digest: 'uAck', envelope: { rkid: KA, epk: 'e', nonce: 'n', ciphertext: 'c' }, threadId: 't', recipient: { contactId: 'c1', rkid: OWN, keyAgreement: KA }, at: 1, attempt: 2, nextAttemptAt: 5, sent: false }, expiresAt: 1770000000000 }
  s.effects.uSent = { ack: { digest: 'uAck2', envelope: { rkid: KA, epk: 'e', nonce: 'n', ciphertext: 'c' }, threadId: 't', recipient: { contactId: 'c1', rkid: OWN, keyAgreement: KA }, at: 1, attempt: 1, sent: true, sentBy: 'horizon' }, expiresAt: 1770000000000 }
  s.effects.uTerminal = { ack: null, expiresAt: 1770000000000 }
  s.outbox.uOut = {
    type: 'https://real-life.org/trust-tasks/star/0.2', threadId: '7d0f0e1c-2a3b-4c5d-8e9f-0a1b2c3d4e5f',
    recipient: { contactId: 'c1', rkid: OWN, keyAgreement: KA },
    envelope: { rkid: KA, epk: 'e', nonce: 'n', ciphertext: 'c' },
    attempt: 2, history: [
      { status: 'submitted', at: 1, attempt: 1 },
      { status: 'awaiting-transport', at: 1, reason: 'offline' },
      { status: 'failed', at: 2, reason: 'rejected-by-receiver', code: 'wrongRecipient' },
      { status: 'submitted', at: 3, attempt: 2 },
      { status: 'failed', at: 4, reason: 'expired-by-adapter-policy' },
      { status: 'delivered', at: 5, late: true },
    ],
    nextAttemptAt: 5,
  }
  s.duties.d1 = { kind: 'reissue-mapping', v: 1, id: 'd1', contactId: 'c1', relId: 'r1', awaitHead: null }
  s.duties.d2 = { kind: 'class-on', v: 1, id: 'd2', contactId: 'c1', relId: 'r1', cls: 'profile' }
  s.duties.d3 = { kind: 'profile', v: 1, id: 'd3', contactId: 'c1', relId: 'r1', rev: '1' }
  s.duties.d4 = { kind: 'continuity', v: 1, id: 'd4', relId: 'r1', tuple: 'pair/' + D1, step: 'probe' }
  s.duties.d5 = { kind: 'merge', v: 1, id: 'd5', entryIds: ['c1', 'c2'], relId: 'r1' }
  s.rotations.g2 = {
    id: 'g2', from: '1', to: '2', step: 'log', startedAt: 3,
    entry: { op: 'anchor.rotate', rotation: { type: 'anchor-rotation@2', proof: { proofValue: 'z' } } },
    overHead: { genesis: D1, entryId: 'uE1', gen: 1, next: DK, commit: 'uC' },
    awaitHead: { r1: null, r2: DK },
  }
  s.prompts.p1 = { id: 'p1', kind: 'group-invite', groupId: D1, openedAt: 4 }
  s.acts.a1 = { actId: 'a1', inputHash: 'uHash', commitSeq: '3', outboundDigests: ['uOut'], at: 4,
    events: [{ type: 'trust.given', eventId: 'e1', actId: 'a1', commitSeq: '3', contactId: 'c1' }] }
  s.encounter = { challenges: { ch1: { v: 1 } }, records: {}, introductions: {} }
  return s
}

const mutate = (f) => { const raw = JSON.parse(encodeState(fullState())); f(raw); return raw }
const codeOf = (fn) => { try { fn() } catch (e) { assert.ok(e instanceof StateCodecError, 'typed error, got ' + e); return e.code } assert.fail('did not throw') }

test('codec: CODEC is 0 and the migration chain is empty', () => {
  assert.equal(CODEC, 0)
  assert.deepEqual(Object.keys(MIGRATIONS), [])
})

test('codec: empty state round-trips as identity on jcs', () => {
  const s = emptyState(CODEC)
  const enc = encodeState(s)
  assert.equal(enc, jcs(s))
  assert.ok(sameState(decodeState(JSON.parse(enc)), s))
  assert.equal(encodeState(decodeState(enc)), enc)            // string input too
})

test('codec: a fully populated state round-trips as identity on jcs', () => {
  const s = fullState()
  const enc = encodeState(s)
  const back = decodeState(JSON.parse(enc))
  assert.equal(jcs(back), jcs(s))
  assert.equal(encodeState(back), enc)
})

test('codec: decodeState returns an independent copy', () => {
  const raw = JSON.parse(encodeState(fullState()))
  const s = decodeState(raw)
  s.contacts.c1.aliases.push('x')
  assert.deepEqual(raw.contacts.c1.aliases, [])
})

test('codec: a higher codec is rejected, never read best-effort', () => {
  const raw = { ...emptyState(CODEC), codec: 1 }
  assert.equal(codeOf(() => decodeState(raw)), 'codec-newer')
})

test('codec: a codec that is not a non-negative integer is rejected', () => {
  for (const codec of [-1, 0.5, '0', null]) assert.equal(codeOf(() => decodeState({ ...emptyState(CODEC), codec })), 'codec-unknown')
  const { codec, ...noCodec } = emptyState(CODEC)
  assert.equal(codeOf(() => decodeState(noCodec)), 'codec-unknown')
})

test('codec: missing, extra and mistyped fields are rejected with a path', () => {
  const missing = JSON.parse(encodeState(fullState())); delete missing.register
  assert.equal(codeOf(() => decodeState(missing)), 'shape')
  try { decodeState(missing) } catch (e) { assert.equal(e.path, '$.register') }
  const deep = JSON.parse(encodeState(fullState())); delete deep.relationships.r1.tuples[0].starOut.hwm
  try { decodeState(deep); assert.fail('accepted') } catch (e) { assert.equal(e.code, 'shape'); assert.equal(e.path, '$.relationships.r1.tuples[0].starOut.hwm') }
  const extra = JSON.parse(encodeState(fullState())); extra.contacts.c1.ui = 'glyph'
  assert.equal(codeOf(() => decodeState(extra)), 'shape')
  const counter = JSON.parse(encodeState(fullState())); counter.profile.revision = 1
  assert.equal(codeOf(() => decodeState(counter)), 'shape')
  const lead = JSON.parse(encodeState(fullState())); lead.profile.revision = '01'
  assert.equal(codeOf(() => decodeState(lead)), 'shape')
  const setting = JSON.parse(encodeState(fullState())); setting.contacts.c1.settings.star = 'maybe'
  assert.equal(codeOf(() => decodeState(setting)), 'shape')
  const badKnown = JSON.parse(encodeState(fullState())); delete badKnown.duties.d2.cls
  assert.equal(codeOf(() => decodeState(badKnown)), 'shape')
})

test('codec: non-JSON input is rejected', () => {
  assert.equal(codeOf(() => decodeState('{not json')), 'not-json')
  const s = emptyState(CODEC); s.contacts = new Map()
  assert.equal(codeOf(() => decodeState(s)), 'not-json')
  const u = emptyState(CODEC); u.profile.body = undefined
  assert.equal(codeOf(() => decodeState(u)), 'not-json')
  assert.equal(codeOf(() => decodeState([])), 'shape')
})

test('codec: an unknown duty kind (or a newer version of a known one) survives load unchanged', () => {
  const s = fullState()
  s.duties.f1 = { kind: 'future-thing', v: 3, id: 'f1', payload: { a: [1, 'b'] } }
  s.duties.f2 = { kind: 'profile', v: 9, id: 'f2', whatever: true }
  const back = decodeState(JSON.parse(encodeState(s)))
  assert.deepEqual(back.duties.f1, s.duties.f1)
  assert.deepEqual(back.duties.f2, s.duties.f2)
  assert.equal(isKnownDuty(back.duties.f1), false)
  assert.equal(isKnownDuty(back.duties.f2), false)
  assert.equal(isKnownDuty(back.duties.d1), true)
  assert.equal(encodeState(back), encodeState(s))
  // the passthrough still needs its envelope: kind, v, id
  const bad = JSON.parse(encodeState(s)); delete bad.duties.f1.v
  assert.equal(codeOf(() => decodeState(bad)), 'shape')
  const keyed = JSON.parse(encodeState(s)); keyed.duties.f1.id = 'other'
  assert.equal(codeOf(() => decodeState(keyed)), 'shape')
})

test('codec: encodeState refuses an invalid state', () => {
  const s = emptyState(CODEC); s.lastWhen = -1
  assert.throws(() => encodeState(s), StateCodecError)
})

test('codec: inherited names are not fields — constructor, toString, __proto__ are rejected', () => {
  for (const k of ['constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(codeOf(() => decodeState(mutate((r) => { r.profile[k] = 123 }))), 'shape', k)
  }
  const text = encodeState(fullState()).replace('"profile":{', '"profile":{"__proto__":123,')
  assert.ok(Object.hasOwn(JSON.parse(text).profile, '__proto__'))
  assert.equal(codeOf(() => decodeState(text)), 'shape')
  // a required field is never satisfied by the prototype chain
  const noBody = mutate((r) => { delete r.profile.body })
  Object.setPrototypeOf(noBody.profile, { body: null })
  assert.equal(codeOf(() => decodeState(noBody)), 'not-json')
})

test('codec: the envelope is sealed to the counterpart key, the own rkid differs', () => {
  const s = decodeState(encodeState(fullState()))
  const item = s.outbox.uOut
  assert.notEqual(item.recipient.rkid, item.envelope.rkid)
  assert.equal(item.envelope.rkid, item.recipient.keyAgreement)
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.outbox.uOut.envelope.rkid = OWN }))), 'shape')
})

test('codec: the group-star domain is typed — sealed carries member and memberOp, digest carries neither', () => {
  const view = (r) => r.relationships.r1.tuples[0].groupStarOut.inflight[1].view
  assert.equal(codeOf(() => decodeState(mutate((r) => { delete view(r)[1].memberOp }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { view(r)[0].member = DK }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { view(r)[0].mode = 'blinded' }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.relationships.r1.tuples[0].groupStarIn.accepted = { salt: '1', blinded: ['b'] } }))), 'shape')
})

test('codec: a salt scope that issued its maximum is representable (2600)', () => {
  const s = decodeState(mutate((r) => { Object.assign(r.relationships.r1.tuples[0].starOut, { lastSalt: '999999999999999999', exhausted: true }) }))
  assert.equal(s.relationships.r1.tuples[0].starOut.exhausted, true)
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.relationships.r1.tuples[0].starOut.lastSalt = '1000000000000000000' }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { delete r.relationships.r1.tuples[0].starOut.exhausted }))), 'shape')
})

test('codec: delivery history has pre-transport reports and no fifth failure reason', () => {
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.outbox.uOut.history.push({ status: 'failed', at: 9, reason: 'give-up' }) }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.outbox.uOut.history.push({ status: 'awaiting-transport', at: 9, reason: 'later' }) }))), 'shape')
})

test('codec: rotation keeps its append closure; journal and events carry commitSeq', () => {
  assert.equal(codeOf(() => decodeState(mutate((r) => { delete r.rotations.g2.overHead }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.rotations.g2.overHead = { genesis: D1, empty: true, gen: 1 } }))), 'shape')
  assert.ok(decodeState(mutate((r) => { r.rotations.g2.overHead = { genesis: D1, empty: true } })))
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.acts.a1.commitSeq = 'v3' }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { r.acts.a1.events[0].version = 'v3' }))), 'shape')
  assert.equal(codeOf(() => decodeState(mutate((r) => { delete r.commitSeq }))), 'shape')
})

// ── the migration contract, driven by a fake chain (nothing of it in src) ──
const fakeChain = (calls) => {
  const need = (field, codec) => (raw) => {
    if (raw.codec !== codec || typeof raw[field] !== 'number') throw new StateCodecError('shape', `codec ${codec} needs ${field}`, '$.' + field)
  }
  return {
    codec: 2,
    validators: { 0: need('a', 0), 1: need('b', 1), 2: need('c', 2) },
    migrations: {
      0: (s) => { calls.push(0); return { codec: 1, b: s.a + 1 } },
      1: (s) => { calls.push(1); return { codec: 2, c: s.b * 10 } },
    },
  }
}

test('codec: migrations run step by step between validated states', () => {
  const calls = []
  assert.deepEqual(decodeChain({ codec: 0, a: 1 }, fakeChain(calls)), { codec: 2, c: 20 })
  assert.deepEqual(calls, [0, 1])
  assert.deepEqual(decodeChain(JSON.stringify({ codec: 1, b: 5 }), fakeChain([])), { codec: 2, c: 50 })
})

test('codec: an invalid input is refused before its first migration runs', () => {
  const calls = []
  assert.equal(codeOf(() => decodeChain({ codec: 0, b: 1 }, fakeChain(calls))), 'shape')
  assert.deepEqual(calls, [])
})

test('codec: a migration step that produces an invalid state stops the chain', () => {
  const calls = []
  const chain = fakeChain(calls)
  chain.migrations[0] = (s) => { calls.push(0); return { codec: 1, a: s.a } }
  assert.equal(codeOf(() => decodeChain({ codec: 0, a: 1 }, chain)), 'shape')
  assert.deepEqual(calls, [0])
  const skip = fakeChain([])
  skip.migrations[0] = () => ({ codec: 2, c: 1 })
  assert.equal(codeOf(() => decodeChain({ codec: 0, a: 1 }, skip)), 'shape')
})

test('codec: a codec without validator or migration is unknown', () => {
  const noVal = fakeChain([]); delete noVal.validators[1]
  assert.equal(codeOf(() => decodeChain({ codec: 0, a: 1 }, noVal)), 'codec-unknown')
  const noMig = fakeChain([]); delete noMig.migrations[1]
  assert.equal(codeOf(() => decodeChain({ codec: 0, a: 1 }, noMig)), 'codec-unknown')
  assert.equal(codeOf(() => decodeChain({ codec: 3 }, fakeChain([]))), 'codec-newer')
})
