#!/usr/bin/env node
// The golden fixtures (lib Stage 2, note §2.2). Codec 1: states written by
// deterministic runs of lib 0.4.0 (test/fixtures/gen-state-v1.mjs), frozen
// since — a released codec's fixtures stay as they are, and the library
// after 0.4.0 sends other wire types, so that generator no longer
// reproduces them. They validate under codec 1, migrate to codec 2 and
// load into a holder. Codec 2 (lib 0.5.0): states written by
// test/fixtures/gen-state-v2.mjs, reproduced here as a gate; they decode,
// re-encode byte-identically, and load into a holder. A newer codec, a
// codec without a validator and a corrupted copy are refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, StateCodecError } from '../dist/internal.js'
import { decodeState as decodeOpaque, createHolder, seedKeys } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { decodeChain } from '../dist/codec.js'
import { jcs } from '../dist/core.js'
import { generate } from './fixtures/gen-state-v2.mjs'

const read = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')
const V1 = ['state-v1.json', 'state-v1-open.json', 'state-v1-register.json']
const V2 = ['state-v2.json', 'state-v2-open.json', 'state-v2-register.json']
const TEXT = read('state-v2.json')
const CHAIN = { codec: CODEC, migrations: MIGRATIONS, validators: VALIDATORS }
const ONLY_V1 = { codec: 1, migrations: {}, validators: { 1: VALIDATORS[1] } }
const codeOf = (fn) => { try { fn() } catch (e) { assert.ok(e instanceof StateCodecError, 'typed error, got ' + e); return e } assert.fail('did not throw') }

// ── codec 1: frozen, migrated ──────────────────────────────────────────

test('codec 1 fixtures: valid under codec 1 and re-encoded byte-identically by its validator alone', () => {
  for (const f of V1) assert.equal(jcs(decodeChain(read(f), ONLY_V1)), read(f), f)
})

test('codec 1 fixtures: migrate to codec 2 — the message state empty but for the ready tuples, every received invitation in the surfaced record, the register empty, nothing else changed', () => {
  for (const f of V1) {
    const v1 = JSON.parse(read(f))
    const s = decodeState(read(f))
    assert.equal(s.codec, 2, f)
    assert.deepEqual({ ...s.messages, ready: [] }, { blocked: [], rates: {}, ready: [], records: {}, inbox: {} }, f)
    // the ready tuples, read from what a counterpart's documents left (readyOf1)
    for (const l of s.messages.ready) assert.ok(Object.values(s.relationships).some((r) => r.tuples.some((t) => t.ownPairLabel === l)), `${f}: ${l} is a tuple`)
    assert.deepEqual(s.joining.surfaced, Object.keys(v1.joining.invites).sort(), f)
    assert.deepEqual(s.joining.declined, [], f)
    const { codec: _a, messages: _m, joining: j2, ...rest2 } = s
    const { codec: _b, joining: j1, ...rest1 } = v1
    assert.equal(jcs(rest2), jcs(rest1), `${f}: the rest of the state is untouched`)
    assert.equal(jcs(j2.preludes), jcs(j1.preludes)); assert.equal(jcs(j2.invites), jcs(j1.invites))
    assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s), `${f}: the migrated state is a fixed point of the codec`)
  }
})

test('codec 1 fixtures: a holder starts over the open one and its prompts are there to decide', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(read('state-v1-open.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xd4)) })
  assert.deepEqual((await h.prompts()).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.ok((await h.contacts()).every((c) => c.blocked === false))
})

// ── codec 2 ────────────────────────────────────────────────────────────

test('codec 2 fixtures: the generator reproduces every fixture byte for byte (gen-state-v2.mjs --check)', async () => {
  const out = await generate()
  assert.deepEqual(Object.keys(out).sort(), [...V2].sort())
  for (const f of V2) assert.equal(out[f], read(f), `${f}: run node test/fixtures/gen-state-v2.mjs — or, for a released codec, leave the fixture and fix the drift`)
})

test('codec 2 fixture: decodes and re-encodes byte-identically', () => {
  assert.equal(CODEC, 2)
  for (const f of V2) {
    const s = decodeState(read(f))
    assert.equal(s.codec, 2)
    assert.equal(encodeState(s), read(f), `${f}: encodeState(decodeState(fixture)) is the fixture, byte for byte`)
    assert.equal(encodeState(decodeState(JSON.parse(read(f)))), read(f), 'from the parsed value too')
    assert.equal(encodeState(decodeChain(read(f), CHAIN)), read(f), 'decodeChain over the library chain is decodeState')
  }
})

test('codec 2 fixture: it holds what the generator ran — encounters, trust, a group, an introduction, a rotation, a profile', () => {
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

test('codec 2 fixtures: the open state holds the work a restart must not lose — prompts, a joining invite, duties, a rotation at step 2, a block and the register', async () => {
  const s = decodeState(read('state-v2-open.json'))
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
  assert.equal((await store.commit(null, decodeOpaque(read('state-v2-open.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xd4)) })
  assert.deepEqual((await h.prompts()).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.equal((await h.contacts()).filter((c) => c.blocked).length, 1)
})

test('codec 2 fixtures: the register state holds a tombstone, a revoked device beside a held one, and carrier entries', () => {
  const s = decodeState(read('state-v2-register.json'))
  assert.equal(s.addresses.tombstones.length, 1)
  assert.deepEqual(s.register.devices, { names: ['laptop', 'phone'], revoked: ['laptop'] })
  assert.deepEqual(Object.values(s.register.carriers).map((c) => c.map((e) => e.generation)), [['1', '2']])
})

test('codec 2 fixture: a holder starts over it and reads its views', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(TEXT))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xa1)) })
  assert.equal((await h.contacts()).length, 2)
  assert.deepEqual((await h.groups()).map((g) => g.name), ['Garden'])
  assert.equal((await h.profile()).name, 'A')
})

// ── refusals ───────────────────────────────────────────────────────────

test('codec fixtures: codec 3 is refused as newer, never read best-effort', () => {
  const raw = { ...JSON.parse(TEXT), codec: 3 }
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
  const unsorted = JSON.parse(read('state-v2-open.json')); unsorted.joining.declined = ['uz', 'ua']
  assert.deepEqual([codeOf(() => decodeState(unsorted)).code, codeOf(() => decodeState(unsorted)).path], ['shape', '$.joining.declined[1]'])
  const half = JSON.parse(read('state-v2-open.json'))
  const [cd] = Object.keys(half.joining.invites); delete half.joining.invites[cd].rkid
  assert.equal(codeOf(() => decodeState(half)).code, 'shape', 'an attribution is a contact and a tuple together')
})
