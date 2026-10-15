#!/usr/bin/env node
// The non-normative HolderState schema of codec 1
// (lib/schemas/holder-state-v1.schema.json): the generated type is fresh,
// every fixture is schema-valid, and the codec's validator and the schema
// agree on the fixtures and on mutations of them — but for the two rules a
// schema cannot state (a record's id equals its key; an envelope's rkid
// equals its recipient's keyAgreement), which the codec alone checks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { makeValidator } from '../dist/core.js'
import { decodeState, StateCodecError } from '../dist/internal.js'
import { renderHolderStateTypes } from '../../scripts/build-holder-state-types.mjs'

const SCHEMA = JSON.parse(readFileSync(new URL('../schemas/holder-state-v1.schema.json', import.meta.url), 'utf8'))
const V = makeValidator({ [SCHEMA.$id]: SCHEMA })
const schemaErrs = (x) => V.validate(x, SCHEMA, SCHEMA)
const FIX = new URL('./fixtures/', import.meta.url)
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL(f, FIX), 'utf8'))])
const codecErr = (x) => { try { decodeState(x); return null } catch (e) { if (e instanceof StateCodecError) return e; throw e } }
const CODEC_ONLY = /must equal its key|must equal recipient\.keyAgreement/

test('holder-state schema: lib/src/holder-state-v1.ts is the generator\'s output (no drift)', () => {
  assert.equal(readFileSync(new URL('../src/holder-state-v1.ts', import.meta.url), 'utf8'), renderHolderStateTypes(SCHEMA),
    'run node scripts/build-holder-state-types.mjs')
})

test('holder-state schema: every fixture is schema-valid and codec-valid', () => {
  assert.ok(fixtures.length >= 1)
  for (const [f, s] of fixtures) {
    assert.deepEqual(schemaErrs(s), [], f)
    assert.equal(codecErr(s), null, f)
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
  for (const [f, s] of fixtures) {
    const all = [...paths(s)].filter((p) => p.length >= 1)
    for (let i = 0; i < 400; i++) {
      const p = all[rnd(all.length)]
      const [name, edit] = EDITS[rnd(EDITS.length)]
      const m = structuredClone(s)
      edit(getAt(m, p.slice(0, -1)), p[p.length - 1])
      const ce = codecErr(m), se = schemaErrs(m)
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

test('holder-state schema: the conditional rules — a listed group without memberAnchor, a snapshot without its digest, a known duty in the wrong shape; an unknown duty kind passes both', () => {
  const [, s] = fixtures.find(([f]) => f === 'state-v1.json')
  const both = (m, ok, why) => { assert.equal(codecErr(m) === null, ok, `codec: ${why}`); assert.equal(schemaErrs(m).length === 0, ok, `schema: ${why}`) }
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
})
