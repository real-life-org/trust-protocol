#!/usr/bin/env node
// The non-normative HolderState schemas of codecs 1, 2 and 3
// (lib/schemas/holder-state-v<n>.schema.json): the generated types are
// fresh, every fixture of a codec is valid under its schema and its codec
// validator, and the two agree on the fixtures and on mutations of them —
// but for the rules a schema cannot state (a record's id equals its key;
// an envelope's rkid equals its recipient's keyAgreement; codec 2: a set of
// strings is sorted), which the codec alone checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { makeValidator } from '../dist/core.js'
import { VALIDATORS, StateCodecError } from '../dist/internal.js'
import { renderHolderStateTypes } from '../../scripts/build-holder-state-types.mjs'

const CODECS = [1, 2, 3]
const SCHEMA = Object.fromEntries(CODECS.map((n) => [n, JSON.parse(readFileSync(new URL(`../schemas/holder-state-v${n}.schema.json`, import.meta.url), 'utf8'))]))
const V = Object.fromEntries(CODECS.map((n) => [n, makeValidator({ [SCHEMA[n].$id]: SCHEMA[n] })]))
const schemaErrs = (n, x) => V[n].validate(x, SCHEMA[n], SCHEMA[n])
const FIX = new URL('./fixtures/', import.meta.url)
/** [file, state, codec]: a fixture is of the codec its name carries */
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, FIX), 'utf8')), Number(/^state-v(\d+)/.exec(f)[1])])
const codecErr = (n, x) => { try { VALIDATORS[n](x); return null } catch (e) { if (e instanceof StateCodecError) return e; throw e } }
const CODEC_ONLY = /must equal its key|must equal recipient\.keyAgreement|a sorted set expected/

test('holder-state schema: lib/src/holder-state-v<n>.ts is the generator\'s output for every codec (no drift)', () => {
  for (const n of CODECS) {
    assert.equal(readFileSync(new URL(`../src/holder-state-v${n}.ts`, import.meta.url), 'utf8'), renderHolderStateTypes(SCHEMA[n], n),
      'run node scripts/build-holder-state-types.mjs')
  }
})

test('holder-state schema: every fixture is valid under its codec\'s schema and validator', () => {
  for (const n of CODECS) assert.ok(fixtures.some(([, , c]) => c === n), `fixtures of codec ${n}`)
  for (const [f, s, n] of fixtures) {
    assert.deepEqual(schemaErrs(n, s), [], f)
    assert.equal(codecErr(n, s), null, f)
  }
})

// deterministic mutations: every node on the way, each of a few edits
function * paths (x, at = []) {
  yield at
  if (x !== null && typeof x === 'object') for (const k of Object.keys(x)) yield * paths(x[k], [...at, k])
}
const getAt = (x, p) => p.reduce((n, k) => n[k], x)
let seed = 7
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
const EDITS = [
  ['delete', (parent, k) => { if (Array.isArray(parent)) parent.splice(Number(k), 1); else delete parent[k] }],
  ['to-string', (parent, k) => { parent[k] = 'x' }],
  ['to-number', (parent, k) => { parent[k] = -1 }],
  ['to-null', (parent, k) => { parent[k] = null }],
  ['to-object', (parent, k) => { parent[k] = { extra: 1 } }],
  ['to-array', (parent, k) => { parent[k] = [] }],
  ['add-field', (parent, k) => { const v = parent[k]; if (v && typeof v === 'object' && !Array.isArray(v)) v.zzExtra = 1; else parent[k] = true }],
]

test('holder-state schema: the codec and the schema agree on mutations of the fixtures (but for the rules only the codec states)', () => {
  let n = 0, rejected = 0, codecOnly = 0
  for (const [f, s, c] of fixtures) {
    const all = [...paths(s)].filter((p) => p.length >= 1)
    for (let i = 0; i < 400; i++) {
      const p = all[rnd(all.length)]
      const [name, edit] = EDITS[rnd(EDITS.length)]
      const m = structuredClone(s)
      edit(getAt(m, p.slice(0, -1)), p[p.length - 1])
      const ce = codecErr(c, m), se = schemaErrs(c, m)
      n++
      if (ce && !se.length) {
        assert.match(ce.message, CODEC_ONLY, `${f} ${name} at ${p.join('.')}: the codec refuses (${ce.message}) what the schema takes`)
        codecOnly++
      } else {
        assert.equal(!!ce, se.length > 0, `${f} ${name} at ${p.join('.')}: codec ${ce ? ce.message : 'ok'} vs schema ${se.slice(0, 2).join('; ') || 'ok'}`)
      }
      if (ce) rejected++
    }
  }
  assert.ok(rejected > n / 2, `most mutations are refused (${rejected}/${n}, ${codecOnly} by the codec alone)`)
})

test('holder-state schema: the conditional rules — a listed group without memberAnchor, a snapshot without its digest, a known duty in the wrong shape, an attribution half present; an unknown duty kind passes both', () => {
  const [, s] = fixtures.find(([f]) => f === 'state-v3.json')
  const [, o] = fixtures.find(([f]) => f === 'state-v3-open.json')
  const both = (m, ok, why) => { assert.equal(codecErr(3, m) === null, ok, `codec: ${why}`); assert.equal(schemaErrs(3, m).length === 0, ok, `schema: ${why}`) }
  const half = structuredClone(o); const cd = Object.keys(half.joining.invites)[0]; delete half.joining.invites[cd].contactId
  both(half, false, 'an invitation with a tuple but no contact')
  const none = structuredClone(o); delete none.joining.invites[cd].contactId; delete none.joining.invites[cd].rkid
  both(none, true, 'an invitation attributed to no relationship (RLTP-MT-3100)')
  const g = structuredClone(s); const gid = Object.keys(g.groups)[0]; delete g.groups[gid].memberAnchor
  both(g, false, 'listed group without memberAnchor')
  const t = structuredClone(s); const tu = Object.values(t.relationships)[0].tuples[0]; tu.starOut.snapshot = null; tu.starOut.snapshotDigest = 'x'
  both(t, false, 'snapshot null, digest set')
  const d = structuredClone(s); d.duties.x = { kind: 'merge', v: 1, id: 'x', relId: 'r' }
  both(d, false, 'a merge duty without entryIds and witness')
  const u = structuredClone(s); u.duties.y = { kind: 'merge', v: 2, id: 'y', anything: [1, 2] }
  both(u, true, 'a merge duty of version 2 is kept as it is')
  const w = structuredClone(s); w.duties.z = { kind: 'future-kind', v: 1, id: 'z', field: { a: 1 } }
  both(w, true, 'an unknown kind is kept as it is')
  // codec 3: a stored ack is sent exactly when it names why, held only while unsent
  const [, tr] = fixtures.find(([f]) => f === 'state-v3-transport.json')
  const sentK = Object.keys(tr.effects).find((k) => tr.effects[k].ack?.sentBy === 'accepted')
  const heldK = Object.keys(tr.effects).find((k) => tr.effects[k].ack?.held !== undefined)
  const a1 = structuredClone(tr); delete a1.effects[sentK].ack.sentBy
  both(a1, false, 'sent without sentBy')
  const a2 = structuredClone(tr); a2.effects[heldK].ack.sentBy = 'horizon'
  both(a2, false, 'unsent with sentBy')
  const a3 = structuredClone(tr); a3.effects[sentK].ack.held = 'offline'
  both(a3, false, 'held and sent')
  const a4 = structuredClone(tr); a4.effects[heldK].ack.held = 'carrier-refused-retriable'
  both(a4, true, 'held for another reason')
})
