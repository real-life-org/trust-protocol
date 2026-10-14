#!/usr/bin/env node
// HolderState codec (lib Stage 2, PR 1): the state is pure JSON under a
// codec version; decodeState validates by hand, rejects an unknown or
// higher codec and every invalid shape with a typed error, and lets
// duty kinds it does not know pass through unchanged.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CODEC, decodeState, encodeState, sameState, StateCodecError, MIGRATIONS, isKnownDuty, jcs } from '../dist/index.js'
import { emptyState } from '../dist/testing.js'

const DK = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const KA = 'z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'
const D1 = 'uEiDYLnFbXqm2cwuJWuk9yNzRmlzWDpCTH6yA_4aP_1z_RA'

/** A state with every collection populated once. */
const fullState = () => {
  const s = emptyState(CODEC)
  s.lastWhen = 1760000000000
  s.register.labels.push('pair/' + D1, 'group/' + D1)
  s.register.pairNonces['pair/' + D1] = 'AAAA'
  s.register.carriers.r1 = [{ nonce: 'AAAA', generation: '1' }]
  s.register.devices.names.push('laptop')
  s.register.community = { genesis: D1, head: '1' }
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
    links: [{ prev: DK, next: DK }], bindings: { [DK]: D1 }, heldCounterpartHead: DK,
    memory: { name: 'Bo' }, provenance: { kind: 'ceremony', at: 1760000000000 }, chainedInto: null,
    tuples: [{
      ownPairLabel: 'pair/' + D1, counterpartAnchor: DK, counterpartKeyAgreement: KA, rkid: KA, entryId: 'c1',
      priorCandidates: [],
      starOut: { nextSalt: '1', hwm: '0', snapshot: null, inflight: {} },
      starIn: { hwm: '0', lowerBound: '0', assembly: null, accepted: null },
      groupStarOut: { nextSalt: '1', hwm: '0', snapshot: [{ member: 'c1', head: DK }], inflight: { 1: { view: [], digests: ['d'], acked: [] } } },
      groupStarIn: { hwm: '0', lowerBound: '0', assembly: { salt: '2', chunks: { 0: { x: 1 } } }, accepted: { salt: '1', blinded: ['b'] } },
      probeOut: { seq: '0' }, probeIn: { hwm: '0', lowerBound: '0', assembly: null },
      continuity: { rev: '0', body: null, recordPrior: null, pending: false },
      mappingOut: { rev: '0', body: null, underAnchor: null },
      mappingIn: { rev: '0', body: null, self: null, card: null },
      profileIn: { rev: '0', body: null, verifiedSeq: '0' },
      deactivated: false,
    }],
  }
  s.groups[D1] = { id: D1, memberLabel: 'pair/' + D1, rules: { vouchThreshold: '1' }, listed: true, membership: null }
  s.profile = { body: { name: 'Al' }, revision: '1' }
  s.effects.uDigest = { ack: { type: 'ack' }, expiresAt: 1770000000000 }
  s.outbox.uOut = {
    type: 'https://real-life.org/trust-tasks/star/0.2', threadId: '7d0f0e1c-2a3b-4c5d-8e9f-0a1b2c3d4e5f',
    recipient: { contactId: 'c1', rkid: KA, keyAgreement: KA },
    envelope: { rkid: KA, epk: 'e', nonce: 'n', ciphertext: 'c' },
    attempt: 1, history: [{ status: 'submitted', at: 1, attempt: 1 }, { status: 'failed', at: 2, reason: 'rejected-by-receiver', code: 'wrongRecipient' }],
    nextAttemptAt: 5,
  }
  s.duties.d1 = { kind: 'reissue-mapping', v: 1, id: 'd1', contactId: 'c1', relId: 'r1', awaitHead: null }
  s.duties.d2 = { kind: 'class-on', v: 1, id: 'd2', contactId: 'c1', relId: 'r1', cls: 'profile' }
  s.duties.d3 = { kind: 'profile', v: 1, id: 'd3', contactId: 'c1', relId: 'r1', rev: '1' }
  s.duties.d4 = { kind: 'continuity', v: 1, id: 'd4', relId: 'r1', tuple: 'pair/' + D1, step: 'probe' }
  s.rotations.g2 = { id: 'g2', from: '1', to: '2', step: 'register', startedAt: 3 }
  s.prompts.p1 = { id: 'p1', kind: 'group-invite', groupId: D1, openedAt: 4 }
  s.acts.a1 = { actId: 'a1', inputHash: 'uHash', version: 'v3', outboundDigests: ['uOut'], at: 4,
    events: [{ type: 'trust.given', eventId: 'e1', actId: 'a1', version: 'v3', contactId: 'c1' }] }
  s.encounter = { challenges: { ch1: { v: 1 } }, records: {}, introductions: {} }
  return s
}

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
