#!/usr/bin/env node
// The golden fixtures (lib Stage 2, note §2.2). Codec 1: states written by
// deterministic runs of lib 0.4.0 (test/fixtures/gen-state-v1.mjs), frozen
// since — a released codec's fixtures stay as they are, and the library
// after 0.4.0 sends other wire types, so that generator no longer
// reproduces them. They validate under codec 1, migrate to codec 2 and
// load into a holder. Codec 2 (lib 0.5.0): states written by
// test/fixtures/gen-state-v2.mjs and gen-state-v2-acks.mjs, frozen since
// 0.6.0; they validate under codec 2 and migrate to codec 3, the stored
// acknowledgements as Delivery 0.83 asks. Codec 3 (lib 0.6.0): states
// written by test/fixtures/gen-state-v3.mjs, reproduced here as a gate;
// they decode, re-encode byte-identically, and load into a holder. A newer
// codec, a codec without a validator and a corrupted copy are refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, StateCodecError } from '../dist/internal.js'
import { decodeState as decodeOpaque, createHolder, seedKeys } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { decodeChain } from '../dist/codec.js'
import { jcs } from '../dist/core.js'
import { generate } from './fixtures/gen-state-v3.mjs'

const read = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')
const V1 = ['state-v1.json', 'state-v1-open.json', 'state-v1-register.json']
const V2 = ['state-v2.json', 'state-v2-open.json', 'state-v2-register.json', 'state-v2-acks.json']
const V3 = ['state-v3.json', 'state-v3-open.json', 'state-v3-register.json', 'state-v3-transport.json']
const TEXT = read('state-v3.json')
const TEXT2 = read('state-v2.json')
const CHAIN = { codec: CODEC, migrations: MIGRATIONS, validators: VALIDATORS }
const ONLY_V1 = { codec: 1, migrations: {}, validators: { 1: VALIDATORS[1] } }
const ONLY_V2 = { codec: 2, migrations: {}, validators: { 2: VALIDATORS[2] } }
/** the chain as lib 0.5.0 had it: 1 → 2 */
const TO_V2 = { codec: 2, migrations: { 1: MIGRATIONS[1] }, validators: { 1: VALIDATORS[1], 2: VALIDATORS[2] } }
const codeOf = (fn) => { try { fn() } catch (e) { assert.ok(e instanceof StateCodecError, 'typed error, got ' + e); return e } assert.fail('did not throw') }

// ── codec 1: frozen, migrated ──────────────────────────────────────────

test('codec 1 fixtures: valid under codec 1 and re-encoded byte-identically by its validator alone', () => {
  for (const f of V1) assert.equal(jcs(decodeChain(read(f), ONLY_V1)), read(f), f)
})

test('codec 1 fixtures: migrate to codec 2 — the message state empty but for the ready tuples, every received invitation in the surfaced record, the register empty, nothing else changed', () => {
  for (const f of V1) {
    const v1 = JSON.parse(read(f))
    const s = decodeChain(read(f), TO_V2)
    assert.equal(s.codec, 2, f)
    assert.equal(decodeState(read(f)).codec, 3, `${f}: and on to codec 3`)
    assert.deepEqual({ ...s.messages, ready: [] }, { blocked: [], rates: {}, ready: [], records: {}, inbox: {} }, f)
    // the ready tuples, read from what a counterpart's documents left (readyOf1)
    for (const l of s.messages.ready) assert.ok(Object.values(s.relationships).some((r) => r.tuples.some((t) => t.ownPairLabel === l)), `${f}: ${l} is a tuple`)
    assert.deepEqual(s.joining.surfaced, Object.keys(v1.joining.invites).sort(), f)
    assert.deepEqual(s.joining.declined, [], f)
    const { codec: _a, messages: _m, joining: j2, ...rest2 } = s
    const { codec: _b, joining: j1, ...rest1 } = v1
    assert.equal(jcs(rest2), jcs(rest1), `${f}: the rest of the state is untouched`)
    assert.equal(jcs(j2.preludes), jcs(j1.preludes)); assert.equal(jcs(j2.invites), jcs(j1.invites))
    assert.equal(jcs(decodeChain(jcs(s), TO_V2)), jcs(s), `${f}: the migrated state is a fixed point of codec 2`)
  }
})

test('codec 1 fixtures: a holder starts over the open one and its prompts are there to decide', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(read('state-v1-open.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xd4)) })
  assert.deepEqual((await h.prompts()).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.ok((await h.contacts()).every((c) => c.blocked === false))
})

// ── codec 2: frozen, migrated ──────────────────────────────────────────

test('codec 2 fixtures: valid under codec 2 and re-encoded byte-identically by its validator alone', () => {
  for (const f of V2) assert.equal(jcs(decodeChain(read(f), ONLY_V2)), read(f), f)
})

test('codec 2 fixtures: migrate to codec 3 — an ack sent by a report becomes unsent, nothing else changes', () => {
  for (const f of V2) {
    const v2 = JSON.parse(read(f))
    const s = decodeState(read(f))
    assert.equal(s.codec, 3, f)
    for (const [d, e] of Object.entries(v2.effects)) {
      const a = e.ack, b = s.effects[d].ack
      if (a === null) { assert.equal(b, null, f); continue }
      if (a.sent && a.sentBy === 'report') {
        const { sent: _s, sentBy: _b, nextAttemptAt: _n, ...rest } = a
        assert.deepEqual(b, { ...rest, sent: false }, `${f}: a reported ack is unsent again, due at once`)
      } else assert.deepEqual(b, a, `${f}: horizon and unsent stay`)
    }
    const { codec: _a, effects: _e, ...rest3 } = s
    const { codec: _b, effects: _f, ...rest2 } = v2
    assert.equal(jcs(rest3), jcs(rest2), `${f}: the rest of the state is untouched`)
    assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s), `${f}: the migrated state is a fixed point of the codec`)
  }
})

test('codec 2 acks fixture (lib 0.5.0): both reported acks migrate unsent; past the horizon, the next resume ends them there and pendingTransport offers only the ack still inside it', async () => {
  const v2 = JSON.parse(read('state-v2-acks.json'))
  const acks = Object.values(v2.effects).map((e) => e.ack).filter(Boolean)
  assert.deepEqual(acks.map((a) => a.sent ? a.sentBy : 'unsent').sort(), ['horizon', 'horizon', 'report', 'report', 'unsent'])
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(read('state-v2-acks.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xb2)) })
  const unsent = Object.values(decodeState(read('state-v2-acks.json')).effects).map((e) => e.ack).filter((a) => a && !a.sent)
  assert.equal(unsent.length, 3, 'the two reported acks are unsent again')
  assert.deepEqual(await h.pendingTransport(v2.lastWhen), { ok: false, code: 'not-resumed' })
  await h.resume(v2.lastWhen)
  const after = Object.values(decodeState((await store.read()).state).effects).map((e) => e.ack).filter(Boolean)
  assert.deepEqual(after.map((a) => a.sent ? a.sentBy : 'unsent').sort(), ['horizon', 'horizon', 'horizon', 'horizon', 'unsent'], 'the formerly reported ones were past their horizon')
  const v = await h.pendingTransport(v2.lastWhen)
  assert.deepEqual(v.entries.filter((e) => e.kind === 'ack').map((e) => e.digest), after.filter((a) => !a.sent).map((a) => a.digest))
})

// ── codec 3 ────────────────────────────────────────────────────────────

test('codec 3 fixtures: the generator reproduces every fixture byte for byte (gen-state-v3.mjs --check)', async () => {
  const out = await generate()
  assert.deepEqual(Object.keys(out).sort(), [...V3].sort())
  for (const f of V3) assert.equal(out[f], read(f), `${f}: run node test/fixtures/gen-state-v3.mjs — or, for a released codec, leave the fixture and fix the drift`)
})

test('codec 3 fixture: decodes and re-encodes byte-identically', () => {
  assert.equal(CODEC, 3)
  for (const f of V3) {
    const s = decodeState(read(f))
    assert.equal(s.codec, 3)
    assert.equal(encodeState(s), read(f), `${f}: encodeState(decodeState(fixture)) is the fixture, byte for byte`)
    assert.equal(encodeState(decodeState(JSON.parse(read(f)))), read(f), 'from the parsed value too')
    assert.equal(encodeState(decodeChain(read(f), CHAIN)), read(f), 'decodeChain over the library chain is decodeState')
  }
})

test('codec 3 transport fixture: acks held, accepted, failed and unsent, an own document held', () => {
  const s = decodeState(read('state-v3-transport.json'))
  const acks = Object.values(s.effects).map((e) => e.ack).filter(Boolean)
  assert.ok(acks.some((a) => !a.sent && a.held === 'offline'))
  assert.ok(acks.some((a) => a.sentBy === 'accepted'))
  assert.ok(acks.some((a) => a.sentBy === 'failed'))
  assert.ok(acks.some((a) => !a.sent && a.held === undefined))
  assert.ok(Object.values(s.outbox).some((it) => it.history.at(-1).status === 'awaiting-transport'))
})

test('codec 3 fixture: it holds what the generator ran — encounters, trust, a group, an introduction, a rotation, a profile', () => {
  const s = decodeState(TEXT)
  assert.equal(Object.keys(s.contacts).length, 2)
  assert.equal(Object.keys(s.encounter.records).length, 2)
  assert.ok(Object.values(s.contacts).some((c) => c.settings.anchorMapping === 'on'), 'trust given')
  assert.ok(Object.values(s.relationships).some((r) => r.tuples.some((t) => t.mappingIn.body !== null && t.starIn.accepted !== null)), 'a mapping and a star received')
  assert.deepEqual(Object.values(s.groups).map((g) => [g.name, Object.keys(g.roster).length]), [['Garden', 2]])
  assert.deepEqual(Object.values(s.encounter.introductions).map((a) => [a.role, a.status]), [['mediator', 'completed']])
  assert.equal(s.register.community.head, '2')
  assert.equal(s.register.lineage.length, 1)
  assert.equal(s.profile.revision, '1')
  assert.ok(Object.keys(s.outbox).length && Object.keys(s.effects).length && Object.keys(s.acts).length)
  assert.deepEqual(Object.values(s.messages.records).map((r) => Object.keys(r).length), [2], 'two messages of B recorded')
  assert.equal(Object.keys(s.messages.inbox).length, 1, 'one taken over, one in the inbox')
  assert.ok(s.messages.ready.length >= 1)
})

test('codec 3 fixtures: the open state holds the work a restart must not lose — prompts, a joining invite, duties, a rotation at step 2, a block and the register', async () => {
  const s = decodeState(read('state-v3-open.json'))
  assert.deepEqual(Object.values(s.prompts).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.deepEqual(Object.values(s.joining.invites).map((i) => i.status), ['open'])
  assert.ok(Object.keys(s.joining.preludes).length >= 1)
  assert.ok(Object.values(s.duties).some((d) => d.kind === 'class-on'))
  assert.deepEqual(Object.values(s.rotations).map((r) => r.step), ['log'])
  assert.ok(Object.values(s.duties).some((d) => d.kind === 'rotation'))
  assert.equal(s.messages.blocked.length, 1)
  assert.equal(s.joining.declined.length, 1)
  assert.equal(s.joining.surfaced.length, 1)
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(read('state-v3-open.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xd4)) })
  assert.deepEqual((await h.prompts()).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.equal((await h.contacts()).filter((c) => c.blocked).length, 1)
})

test('codec 3 fixtures: the register state holds a tombstone, a revoked device beside a held one, and carrier entries', () => {
  const s = decodeState(read('state-v3-register.json'))
  assert.equal(s.addresses.tombstones.length, 1)
  assert.deepEqual(s.register.devices, { names: ['laptop', 'phone'], revoked: ['laptop'] })
  assert.deepEqual(Object.values(s.register.carriers).map((c) => c.map((e) => e.generation)), [['1', '2']])
})

test('codec 3 fixture: a holder starts over it and reads its views', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(TEXT))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xa1)) })
  assert.equal((await h.contacts()).length, 2)
  assert.deepEqual((await h.groups()).map((g) => g.name), ['Garden'])
  assert.equal((await h.profile()).name, 'A')
})

// ── refusals ───────────────────────────────────────────────────────────

test('codec fixtures: codec 4 is refused as newer, never read best-effort', () => {
  const raw = { ...JSON.parse(TEXT), codec: 4 }
  assert.equal(codeOf(() => decodeChain(raw, CHAIN)).code, 'codec-newer')
  assert.equal(codeOf(() => decodeState(JSON.stringify(raw))).code, 'codec-newer')
})

test('codec fixtures: a codec without a validator (0) is refused as codec-unknown', () => {
  const e = codeOf(() => decodeState({ ...JSON.parse(TEXT), codec: 0 }))
  assert.equal(e.code, 'codec-unknown')
  assert.equal(codeOf(() => decodeOpaque({ ...JSON.parse(TEXT), codec: 0 })).code, 'codec-unknown', 'the root decodeState too')
})

test('codec fixtures: a corrupted copy is refused — truncated text, a mistyped field, an unknown field, an unsorted register', () => {
  assert.equal(codeOf(() => decodeChain(TEXT.slice(0, -10), CHAIN)).code, 'not-json')
  const bad = JSON.parse(TEXT)
  const id = Object.keys(bad.contacts)[0]
  bad.contacts[id].status = 'trusted'
  const e = codeOf(() => decodeChain(bad, CHAIN))
  assert.deepEqual([e.code, e.path], ['shape', `$.contacts.${id}.status`])
  const extra = JSON.parse(TEXT); extra.register.extra = true
  assert.deepEqual([codeOf(() => decodeState(extra)).code, codeOf(() => decodeState(extra)).path], ['shape', '$.register.extra'])
  const swapped = JSON.parse(TEXT); swapped.commitSeq = 74
  assert.equal(codeOf(() => decodeState(swapped)).code, 'shape')
  const unsorted = JSON.parse(read('state-v3-open.json')); unsorted.joining.declined = ['uz', 'ua']
  assert.deepEqual([codeOf(() => decodeState(unsorted)).code, codeOf(() => decodeState(unsorted)).path], ['shape', '$.joining.declined[1]'])
  const half = JSON.parse(read('state-v3-open.json'))
  const [cd] = Object.keys(half.joining.invites); delete half.joining.invites[cd].rkid
  assert.equal(codeOf(() => decodeState(half)).code, 'shape', 'an attribution is a contact and a tuple together')
})

test('codec fixtures (Anton review #111): each codec takes its own outbox fields only — expiresAt and failed(task-expired) are refused under codec 1 before any migration, taken under codec 2', () => {
  const v1 = JSON.parse(read('state-v1.json'))
  const [d1] = Object.keys(v1.outbox)
  const life = structuredClone(v1); life.outbox[d1].expiresAt = v1.lastWhen + 1000
  const expired = structuredClone(v1); expired.outbox[d1].history.push({ status: 'failed', at: v1.lastWhen, reason: 'task-expired' })
  for (const [why, x] of [['expiresAt', life], ['task-expired', expired]]) {
    assert.equal(codeOf(() => VALIDATORS[1](x)).code, 'shape', `codec 1 refuses ${why}`)
    assert.equal(codeOf(() => decodeState(x)).code, 'shape', `decodeState refuses ${why} before migrating`)
  }
  const v2 = JSON.parse(TEXT2)
  const [d2] = Object.keys(v2.outbox)
  const life2 = structuredClone(v2); life2.outbox[d2].expiresAt = v2.lastWhen + 1000
  const exp2 = structuredClone(v2); exp2.outbox[d2].history.push({ status: 'failed', at: v2.lastWhen, reason: 'task-expired' })
  assert.doesNotThrow(() => VALIDATORS[2](life2))
  assert.doesNotThrow(() => VALIDATORS[2](exp2))
  // and the other codec-2 additions: messages, joining.surfaced/declined, an unattributed invite, the new events
  const m = structuredClone(v1); m.messages = { blocked: [], rates: {}, ready: [], records: {}, inbox: {} }
  assert.equal(codeOf(() => VALIDATORS[1](m)).code, 'shape', 'codec 1 refuses messages')
  const j = structuredClone(v1); j.joining.surfaced = []
  assert.equal(codeOf(() => VALIDATORS[1](j)).code, 'shape', 'codec 1 refuses joining.surfaced')
  // codec 2 refuses what codec 1 had and codec 2 lacks: a codec-2 state without messages
  const n2 = structuredClone(v2); delete n2.messages
  assert.equal(codeOf(() => VALIDATORS[2](n2)).code, 'shape')
})

test('codec fixtures (Delivery 0.83): a stored ack is sent exactly when it names why, held only while unsent; codec 3 refuses report, codec 2 refuses accepted', () => {
  const v3 = JSON.parse(read('state-v3-transport.json'))
  const d = Object.keys(v3.effects).find((k) => v3.effects[k].ack?.held === 'offline')
  const sent = Object.keys(v3.effects).find((k) => v3.effects[k].ack?.sentBy === 'accepted')
  const cases = [
    ['sentBy report', (x) => { x.effects[sent].ack.sentBy = 'report' }, `$.effects.${sent}.ack.sentBy`],
    ['sent without sentBy', (x) => { delete x.effects[sent].ack.sentBy }, `$.effects.${sent}.ack.sentBy`],
    ['unsent with sentBy', (x) => { x.effects[d].ack.sentBy = 'horizon'; delete x.effects[d].ack.held }, `$.effects.${d}.ack.sentBy`],
    ['held and sent', (x) => { x.effects[sent].ack.held = 'offline' }, `$.effects.${sent}.ack.held`],
  ]
  for (const [why, edit, path] of cases) {
    const x = structuredClone(v3); edit(x)
    const e = codeOf(() => VALIDATORS[3](x))
    assert.deepEqual([e.code, e.path], ['shape', path], why)
  }
  const v2 = JSON.parse(TEXT2)
  const [k] = Object.keys(v2.effects).filter((x) => v2.effects[x].ack)
  const acc = structuredClone(v2); acc.effects[k].ack = { ...acc.effects[k].ack, sent: true, sentBy: 'accepted' }
  assert.equal(codeOf(() => VALIDATORS[2](acc)).code, 'shape', 'codec 2 knows no accepted')
  const held = structuredClone(v2); held.effects[k].ack = { ...held.effects[k].ack, held: 'offline' }
  assert.equal(codeOf(() => VALIDATORS[2](held)).code, 'shape', 'codec 2 knows no held')
})
