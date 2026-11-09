#!/usr/bin/env node
// The golden fixtures (lib Stage 2, note §2.2) of codec 6 (lib 0.16.0),
// the codec this library writes: states written by
// test/fixtures/gen-state-v6.mjs, reproduced here as a gate; they decode,
// re-encode byte-identically, and load into a holder. The fixtures of
// codec 5 (lib 0.13.0 to 0.15.0), codec 4 (lib 0.10.0 to 0.12.0) and codec 3 (lib 0.6.0 to 0.9.1) are kept
// as they were written and decode through the migrations. Codecs 1 and 2 (lib 0.4.0, 0.5.0) never
// held a rolled-out app's state and are refused as codec-unknown, as are
// a newer codec and a corrupted copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CODEC, MIGRATIONS, VALIDATORS, decodeState, encodeState, StateCodecError } from '../dist/internal.js'
import { decodeState as decodeOpaque, createHolder, seedKeys } from '../dist/index.js'
import { InMemoryStore } from '../dist/testing.js'
import { decodeChain } from '../dist/codec.js'
import { jcs } from '../dist/core.js'
import { generate } from './fixtures/gen-state-v6.mjs'

const read = (f) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')
const V6 = ['state-v6.json', 'state-v6-open.json', 'state-v6-register.json', 'state-v6-transport.json']
const TEXT = read('state-v6.json')
const CHAIN = { codec: CODEC, migrations: MIGRATIONS, validators: VALIDATORS }
const codeOf = (fn) => { try { fn() } catch (e) { assert.ok(e instanceof StateCodecError, 'typed error, got ' + e); return e } assert.fail('did not throw') }

// ── codec 6 ────────────────────────────────────────────────────────────

test('a codec-3 state of lib 0.8 is refused: its Type URIs lie outside the namespace (codec-type-uri, Delivery RLTP-DEL-3010)', () => {
  // state-v3-lib-0.8.json is the open fixture as lib 0.8.0 wrote it, kept unchanged
  const old = read('state-v3-lib-0.8.json')
  assert.match(old, /https:\/\/real-life\.org\/trust-tasks\/(?!spec\/)/, 'the sample carries the earlier names')
  const e = codeOf(() => decodeState(old))
  assert.equal(e.code, 'codec-type-uri')
  assert.match(e.path, /^\$\./, 'the path names the first earlier name')
  // the same state with the names under /spec/ decodes: only the names are refused
  const moved = old.replace(/https:\/\/real-life\.org\/trust-tasks\/(?!spec\/)/g, 'https://real-life.org/trust-tasks/spec/')
  assert.equal(decodeState(moved).codec, 6, 'migrated from codec 3')
  // every place the state holds a document's type is read
  const base = JSON.parse(read('state-v6.json'))
  const earlier = 'https://real-life.org/trust-tasks/membership-invite/0.2'
  const at = (mutate) => { const s = structuredClone(base); mutate(s); return codeOf(() => decodeState(s)) }
  const [o] = Object.keys(base.outbox)
  assert.equal(at((s) => { s.outbox[o].type = earlier }).path, `$.outbox.${o}.type`)
  const [g] = Object.keys(base.groups)
  const doc = { type: earlier, payload: {} }
  assert.equal(at((s) => { s.groups[g].invitations.t = { invitee: 'a', keyAgreement: 'k', contactId: 'c', rkid: 'r', threadId: 't', credDigest: 'd', invite: doc, validUntil: 1 } }).path, `$.groups.${g}.invitations.t.invite.type`)
  assert.equal(at((s) => { s.groups[g].evidence.x = { invite: { type: 'https://real-life.org/trust-tasks/spec/membership-invite/0.2' }, accept: doc, vouches: [], at: 1 } }).code, 'codec-type-uri')
  assert.equal(at((s) => { s.groups[g].evidence.x = { invite: doc, accept: { type: 'https://real-life.org/trust-tasks/spec/membership-accept/0.2' }, vouches: [], at: 1 } }).path, `$.groups.${g}.evidence.x.invite.type`)
  assert.equal(at((s) => { s.groups[g].evidence.x = { invite: { type: 'https://real-life.org/trust-tasks/spec/membership-invite/0.2' }, accept: doc, vouches: [], at: 1 } }).path, `$.groups.${g}.evidence.x.accept.type`)
  // a received invitation, on the open fixture, which holds one
  const open = JSON.parse(read('state-v6-open.json'))
  const [j] = Object.keys(open.joining.invites)
  open.joining.invites[j].invite.type = earlier
  assert.equal(codeOf(() => decodeState(open)).path, `$.joining.invites.${j}.invite.type`)
})

test('free text that looks like an earlier Type URI never refuses a state: only the places that hold a type are read (review 2 of #129)', () => {
  // a counterpart's message or profile text, a group's name and the own profile are text, not types
  const text = 'https://real-life.org/trust-tasks/foo/0.1'
  const s = JSON.parse(read('state-v6.json'))
  const [m] = Object.keys(s.messages.inbox)
  s.messages.inbox[m].body.text = text
  const tuple = Object.values(s.relationships).flatMap((r) => r.tuples).find((t) => t.profileIn.body !== null)
  tuple.profileIn.body.text = text
  for (const g of Object.values(s.groups)) g.name = text
  s.profile.body.text = text
  const back = decodeState(s)
  assert.equal(back.messages.inbox[m].body.text, text)
  assert.equal(back.profile.body.text, text)
})

test('codec 6 fixtures: the generator reproduces every fixture byte for byte (gen-state-v6.mjs --check)', async () => {
  const out = await generate()
  assert.deepEqual(Object.keys(out).sort(), [...V6].sort())
  // for a released codec, leave the fixture and fix the drift
  for (const f of V6) assert.equal(out[f], read(f), `${f}: run node test/fixtures/gen-state-v6.mjs — or, for a released codec, leave the fixture and fix the drift`)
})

test('codec 5 fixture: decodes and re-encodes byte-identically', () => {
  assert.equal(CODEC, 6)
  for (const f of V6) {
    const s = decodeState(read(f))
    assert.equal(s.codec, 6)
    assert.equal(encodeState(s), read(f), `${f}: encodeState(decodeState(fixture)) is the fixture, byte for byte`)
    assert.equal(encodeState(decodeState(JSON.parse(read(f)))), read(f), 'from the parsed value too')
    assert.equal(encodeState(decodeChain(read(f), CHAIN)), read(f), 'decodeChain over the library chain is decodeState')
  }
})

test('codec 6 transport fixture: acks held, accepted, failed and unsent, an own document held by the adapter, one accepted and held at the recipient', () => {
  const s = decodeState(read('state-v6-transport.json'))
  const acks = Object.values(s.effects).map((e) => e.ack).filter(Boolean)
  assert.ok(acks.some((a) => !a.sent && a.held === 'offline'))
  assert.ok(acks.some((a) => a.sentBy === 'accepted'))
  assert.ok(acks.some((a) => a.sentBy === 'failed'))
  assert.ok(acks.some((a) => !a.sent && a.held === undefined))
  assert.ok(Object.values(s.outbox).some((it) => it.history.at(-1).status === 'awaiting-transport'))
  const held = Object.values(s.outbox).filter((it) => it.history.some((x) => x.status === 'accepted' && x.held === true))
  assert.equal(held.length, 1, 'one document accepted and held (Delivery RLTP-DEL-6140)')
  assert.deepEqual(held[0].history.slice(-2).map((x) => [x.status, x.held]), [['accepted', undefined], ['accepted', true]])
})

// ── codec 3: kept as written, read through the migration ──────────────

const V3 = ['state-v3.json', 'state-v3-open.json', 'state-v3-register.json', 'state-v3-transport.json']

// What the earlier codecs need is that their states still read, which the
// migration checks below carry.
test('codec 3 fixtures: each decodes, migrates to the current codec, and re-encodes stably; 3 → 4 changes the version alone', () => {
  for (const f of V3) {
    const s = decodeState(read(f))
    assert.equal(s.codec, 6, `${f}: migrated`)
    assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s), `${f}: stable`)
    assert.equal(jcs(MIGRATIONS[3](JSON.parse(read(f)))), jcs({ ...JSON.parse(read(f)), codec: 4 }), `${f}: 3 → 4 changes the version alone`)
  }
})

// ── codec 4: kept as written, read through the migration ──────────────

const V4 = ['state-v4.json', 'state-v4-open.json', 'state-v4-register.json', 'state-v4-transport.json']

test('codec 4 fixtures: each decodes and migrates through codec 5 to 6 — a group loses the genesis of the earlier form and stands as a member\'s group without a log, its roster kept; nothing else changes', () => {
  let groups = 0
  for (const f of V4) {
    const v4 = JSON.parse(read(f))
    const s = decodeState(read(f))
    assert.equal(s.codec, 6, `${f}: migrated`)
    assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s), `${f}: stable`)
    for (const [id, g] of Object.entries(s.groups)) {
      groups++
      assert.deepEqual([g.phase, g.syncs, g.log, g.genesis], ['member', {}, undefined, undefined], `${f}: ${id}`)
      assert.deepEqual(g.roster, v4.groups[id].roster)
      const { genesis: _g, ...kept } = v4.groups[id]
      assert.deepEqual({ ...g }, { ...kept, phase: 'member', syncs: {} })
    }
    const { groups: _a, codec: _b, sharedConnect: _sc, ...rest } = s
    const { groups: _c, codec: _d, ...was } = v4
    assert.deepEqual(_sc, { enactments: {} }, `${f}: the codec-6 slice is empty`)
    assert.equal(jcs(rest), jcs(was), `${f}: everything but the groups and the new slice is as written`)
  }
  assert.ok(groups >= 1)
})

test('codec 4 fixture: a group of the earlier form loads into a holder and is shown; it issues no invitation (no log)', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(read('state-v4.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xa1)) })
  const [g] = await h.groups()
  assert.deepEqual([g.name, g.members.length], ['Garden', 2])
  const [c] = await h.contacts()
  const r = await h.invite(g.id, c.id, { when: Date.parse('2026-10-16T09:00:00Z'), actId: 'late-invite' })
  assert.deepEqual([r.ok, r.code], [false, 'unknown-group'])
})

test('codec 3 fixtures: a codec-3 state with a held step is refused — held exists from codec 4 on', () => {
  const x = JSON.parse(read('state-v3-transport.json'))
  const [d] = Object.keys(x.outbox)
  x.outbox[d].history.push({ status: 'accepted', at: 1, held: true })
  const e = codeOf(() => decodeState(x))
  assert.deepEqual([e.code, e.path], ['shape', `$.outbox.${d}.history[${x.outbox[d].history.length - 1}].held`])
})

test('codec 3 transport fixture (the Play release, lib 0.9.1) loads into a holder; its outbox and acks are intact', async () => {
  const text = read('state-v3-transport.json')
  const v3 = JSON.parse(text)
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(text))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xb2)) })
  const items = []
  for (const d of Object.keys(v3.outbox)) items.push(...(await h.deliveryStatus(d)).items)
  assert.equal(items.length, Object.keys(v3.outbox).length)
  assert.ok(items.length >= 1)
  for (const i of items) assert.equal(i.status, v3.outbox[i.digest].history.findLast((x) => x.status !== 'awaiting-transport')?.status ?? 'submitted')
  assert.ok(items.every((i) => i.held === undefined))
})

test('codec 5 fixture: it holds what the generator ran — encounters, trust, a group, an introduction, a rotation, a profile', () => {
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

test('codec 5 fixtures: the open state holds the work a restart must not lose — prompts, a joining invite, duties, a rotation at step 2, a block and the register', async () => {
  const s = decodeState(read('state-v6-open.json'))
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
  assert.equal((await store.commit(null, decodeOpaque(read('state-v6-open.json')))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xd4)) })
  assert.deepEqual((await h.prompts()).map((p) => p.kind).sort(), ['encounter-confirm', 'group-invite'])
  assert.equal((await h.contacts()).filter((c) => c.blocked).length, 1)
})

test('codec 5 fixtures: the register state holds a tombstone, a revoked device beside a held one, and carrier entries', () => {
  const s = decodeState(read('state-v6-register.json'))
  assert.equal(s.addresses.tombstones.length, 1)
  assert.deepEqual(s.register.devices, { names: ['laptop', 'phone'], revoked: ['laptop'] })
  assert.deepEqual(Object.values(s.register.carriers).map((c) => c.map((e) => e.generation)), [['1', '2']])
})

test('codec 5 fixture: a holder starts over it and reads its views', async () => {
  const store = new InMemoryStore()
  assert.equal((await store.commit(null, decodeOpaque(TEXT))).ok, true)
  const h = await createHolder({ store, keys: seedKeys(new Uint8Array(64).fill(0xa1)) })
  assert.equal((await h.contacts()).length, 2)
  assert.deepEqual((await h.groups()).map((g) => g.name), ['Garden'])
  assert.equal((await h.profile()).name, 'A')
})

// ── refusals ───────────────────────────────────────────────────────────

test('codec fixtures: codec 7 is refused as newer, never read best-effort', () => {
  const raw = { ...JSON.parse(TEXT), codec: 7 }
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
  const unsorted = JSON.parse(read('state-v6-open.json')); unsorted.joining.declined = ['uz', 'ua']
  assert.deepEqual([codeOf(() => decodeState(unsorted)).code, codeOf(() => decodeState(unsorted)).path], ['shape', '$.joining.declined[1]'])
  const half = JSON.parse(read('state-v6-open.json'))
  const [cd] = Object.keys(half.joining.invites); delete half.joining.invites[cd].rkid
  assert.equal(codeOf(() => decodeState(half)).code, 'shape', 'an attribution is a contact and a tuple together')
})

test('codec fixtures: codec 1 and 2 (lib 0.4.0, 0.5.0) are codec-unknown — no migration, a clean cut', () => {
  for (const c of [1, 2]) {
    assert.equal(codeOf(() => decodeState({ ...JSON.parse(TEXT), codec: c })).code, 'codec-unknown', `codec ${c}`)
    assert.equal(codeOf(() => decodeOpaque({ ...JSON.parse(TEXT), codec: c })).code, 'codec-unknown', `codec ${c}, the root decodeState`)
  }
  assert.deepEqual(Object.keys(MIGRATIONS), ['3', '4', '5'], 'three migrations: codec 3 to 4, codec 4 to 5, codec 5 to 6')
})

test('codec fixtures (Delivery 0.83): a stored ack is sent exactly when it names why, held only while unsent; report is refused', () => {
  const v3 = JSON.parse(read('state-v6-transport.json'))
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
    const e = codeOf(() => VALIDATORS[6](x))
    assert.deepEqual([e.code, e.path], ['shape', path], why)
  }
})

// ── codec 5: kept as written, read through the migration ──────────────

const V5 = ['state-v5.json', 'state-v5-open.json', 'state-v5-register.json', 'state-v5-transport.json']

test('codec 5 fixtures: each decodes, migrates to codec 6 with an empty shared-connect slice, and re-encodes stably', () => {
  for (const f of V5) {
    const s = decodeState(read(f))
    assert.equal(s.codec, 6, `${f}: migrated`)
    assert.deepEqual(s.sharedConnect, { enactments: {} })
    assert.equal(encodeState(decodeState(encodeState(s))), encodeState(s), `${f}: stable`)
    const raw = JSON.parse(read(f))
    assert.equal(jcs(MIGRATIONS[5](raw)), jcs({ ...raw, codec: 6, sharedConnect: { enactments: {} } }), `${f}: 5 → 6 adds the slice alone`)
  }
})
