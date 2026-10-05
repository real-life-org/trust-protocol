// Probes for scripts/check-encounter-trace.mjs — every way the checker
// must fail, and the one way it passes.
//   usage: node --test scripts/check-encounter-trace.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkTrace, parseSpecRules, inventoryIds, manifestIds } from './check-encounter-trace.mjs'

const dir = mkdtempSync(join(tmpdir(), 'enc-trace-'))
let n = 0
const file = (content) => { const p = join(dir, `f${n++}.md`); writeFileSync(p, content); return p }
const spec = (rules) => file(`# Spec\n\n${rules}\n`)
const manifest = (ids) => file(ids.map((i) => `${i}\n`).join(''))
const inventory = (ids) => file(ids.map((i) => `| ${i} | § | MUST | x | y | z | § |\n`).join(''))
const GOOD = '**RLTP-ENC-2010** — An anchor MUST be a did:key.\n\n**RLTP-ENC-2020** — A signature MUST verify.'
const run = (s, m, inv) => checkTrace({ spec: spec(s), manifest: manifest(m), inventory: inv === undefined ? null : inventory(inv) })
const has = (r, part) => assert.ok(r.errors.some((e) => e.includes(part)), `expected an error containing "${part}", got: ${JSON.stringify(r.errors)}`)

test('complete trace passes, with and without inventory', () => {
  assert.deepEqual(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020']).errors, [])
  assert.deepEqual(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020'], ['RLTP-ENC-2010', 'RLTP-ENC-2020']).errors, [])
})

test('a listed ID that is not a rule fails; an unlisted rule fails', () => {
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020', 'RLTP-ENC-2030']), 'RLTP-ENC-2030: in the manifest, not a rule')
  has(run(GOOD, ['RLTP-ENC-2010']), 'RLTP-ENC-2020: a rule in the specification, not in the manifest')
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020'], ['RLTP-ENC-2010']), 'not in the inventory')
})

test('a duplicate rule fails, also when the copy is indented or fenced', () => {
  has(run(GOOD + '\n\n**RLTP-ENC-2010** — Again.', ['RLTP-ENC-2010', 'RLTP-ENC-2020']), 'appears 2 times')
  has(run(GOOD + '\n\n  **RLTP-ENC-2010** — Indented copy.', ['RLTP-ENC-2010', 'RLTP-ENC-2020']), 'is indented')
  has(run(GOOD + '\n\n```\n**RLTP-ENC-2010** — Fenced copy.\n```', ['RLTP-ENC-2010', 'RLTP-ENC-2020']), 'inside a code fence')
})

test('a rule only inside a code fence does not count', () => {
  const r = run('```\n**RLTP-ENC-2010** — Only here.\n```', ['RLTP-ENC-2010'])
  has(r, 'inside a code fence')
  has(r, 'RLTP-ENC-2010: in the manifest, not a rule')
})

test('a bare marker, a missing separator, an empty statement and a malformed ID fail', () => {
  has(run('**RLTP-ENC-2010**', ['RLTP-ENC-2010']), 'no "— <statement>"')
  has(run('**RLTP-ENC-2010** An anchor MUST be.', ['RLTP-ENC-2010']), 'no "— <statement>"')
  has(run('**RLTP-ENC-2010** — ', ['RLTP-ENC-2010']), 'no "— <statement>"')
  has(run('**RLTP-ENC-20** — Too short.', ['RLTP-ENC-20']), 'malformed rule identifier')
  has(run('**RLTP-ENC-2010a** — Suffix.', ['RLTP-ENC-2010']), 'malformed rule identifier')
})

test('empty manifest, empty inventory and empty specification fail', () => {
  has(run(GOOD, []), 'manifest lists no rule identifiers')
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020'], []), 'inventory lists no rule identifiers')
  has(run('', []), 'manifest lists no rule identifiers')
  assert.ok(run('', []).errors.length > 0)
})

test('a missing manifest or an explicitly named missing inventory fails', () => {
  has(checkTrace({ spec: spec(GOOD), manifest: join(dir, 'nope.txt') }), 'manifest not found')
  has(checkTrace({ spec: spec(GOOD), manifest: manifest(['RLTP-ENC-2010', 'RLTP-ENC-2020']), inventory: join(dir, 'nope.md') }), 'inventory not found')
})

test('a manifest listing an ID twice or a malformed ID fails', () => {
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2010', 'RLTP-ENC-2020']), 'lists RLTP-ENC-2010 more than once')
  has(run(GOOD, ['RLTP-ENC-2010', 'RLTP-ENC-2020', 'ENC-9']), 'malformed identifier')
})

test('parsers: inventory rows and manifest lines', () => {
  assert.deepEqual(inventoryIds('| RLTP-ENC-2010 | a |\n| = RLTP-ENC-2010 | b |\n| RLTP-ENC-2020 | c |'), ['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  assert.deepEqual(manifestIds('# c\n\nRLTP-ENC-2010\n RLTP-ENC-2020 \n'), ['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  const p = parseSpecRules(GOOD)
  assert.deepEqual(p.rules.map((r) => r.id), ['RLTP-ENC-2010', 'RLTP-ENC-2020'])
  assert.deepEqual(p.problems, [])
})
