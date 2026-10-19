#!/usr/bin/env node
// The golden fixtures of codec 1 (lib Stage 2, note §2.2): states written
// by deterministic runs of lib 0.4.0 (test/fixtures/gen-state-v1.mjs), frozen
// since: a released codec's fixtures stay as they are, and the library
// after 0.4.0 writes other wire types (the registered prelude of Membership
// 0.20), so the generator no longer reproduces them. They decode, re-encode
// byte-identically, and load into a holder; a newer codec, a codec without
// a validator and a corrupted copy are refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, StateCodecError } from '../dist/internal.js'
import { decodeState as decodeOpaque, createHolder, seedKeys } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { decodeChain } from '../dist/codec.js'

const TEXT = readFileSync(new URL('./fixtures/state-v1.json', import.meta.url), 'utf8')
const CHAIN = { codec: CODEC, migrations: MIGRATIONS, validators: VALIDATORS }
const codeOf = (fn) => { try { fn() } catch (e) { assert.ok(e instanceof StateCodecError, 'typed error, got ' + e); return e } assert.fail('did not throw') }

test('codec 1 fixture: decodes and re-encodes byte-identically', () => {
  assert.equal(CODEC, 1)
  const s = decodeState(TEXT)
  assert.equal(s.codec, 1)
  assert.equal(encodeState(s), TEXT, 'encodeState(decodeState(fixture)) is the fixture, byte for byte')
  assert.equal(encodeState(decodeState(JSON.parse(TEXT))), TEXT, 'from the parsed value too')
  assert.equal(encodeState(decodeChain(TEXT, CHAIN)), TEXT, 'decodeChain over the library chain is decodeState')
})

test('codec 1 fixture: it holds what the generator ran — encounters, trust, a group, an introduction, a rotation, a profile', () => {
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
})

test('codec 1 fixture: a holder starts over it and reads its views', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(TEXT))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xa1)) })
  const contacts = await h.contacts()
  assert.equal(contacts.length, 2)
  assert.deepEqual((await h.groups()).map((g) => g.name), ['Garden'])
  assert.equal((await h.profile()).name, 'A')
})

test('codec 1 fixture: codec 2 is refused as newer, never read best-effort', () => {
  const raw = { ...JSON.parse(TEXT), codec: 2 }
  assert.equal(codeOf(() => decodeChain(raw, CHAIN)).code, 'codec-newer')
  assert.equal(codeOf(() => decodeState(JSON.stringify(raw))).code, 'codec-newer')
})

test('codec 1 fixture: a codec without a validator (0) is refused as codec-unknown', () => {
  const e = codeOf(() => decodeState({ ...JSON.parse(TEXT), codec: 0 }))
  assert.equal(e.code, 'codec-unknown')
  assert.equal(codeOf(() => decodeOpaque({ ...JSON.parse(TEXT), codec: 0 })).code, 'codec-unknown', 'the root decodeState too')
})

test('codec 1 fixture: a corrupted copy is refused — truncated text, a mistyped field, an unknown field', () => {
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
})

const FILES = ['state-v1.json', 'state-v1-open.json', 'state-v1-register.json']
const read = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')

test('codec 1 fixtures: each decodes and re-encodes byte-identically', () => {
  for (const f of FILES) assert.equal(encodeState(decodeState(read(f))), read(f), f)
})

test('codec 1 fixtures: the open state holds the work a restart must not lose — prompts, a joining invite, duties, a rotation at step 2', async () => {
  const s = decodeState(read('state-v1-open.json'))
  assert.deepEqual(Object.values(s.prompts).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.deepEqual(Object.values(s.joining.invites).map((i) => i.status), ['open'])
  assert.equal(Object.keys(s.joining.preludes).length, 1)
  assert.ok(Object.values(s.duties).some((d) => d.kind === 'class-on'))
  assert.deepEqual(Object.values(s.rotations).map((r) => r.step), ['log'])
  assert.ok(Object.values(s.duties).some((d) => d.kind === 'rotation'))
  // a holder starts over it and the open prompts are there to decide
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(read('state-v1-open.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xd4)) })
  assert.deepEqual((await h.prompts()).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
})

test('codec 1 fixtures: the register state holds a tombstone, a revoked device beside a held one, and carrier entries', () => {
  const s = decodeState(read('state-v1-register.json'))
  assert.equal(s.addresses.tombstones.length, 1)
  assert.deepEqual(s.register.devices, { names: ['laptop', 'phone'], revoked: ['laptop'] })
  assert.deepEqual(Object.values(s.register.carriers).map((c) => c.map((e) => e.generation)), [['1', '2']])
})
