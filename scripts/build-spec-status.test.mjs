import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BEGIN, END, splitSpec, joinSpec, replaceBetween, renderSpecBlock, checkStatus } from './build-spec-status.mjs'

const STATUSES = { built: '', 'built-differently': '', superseded: '', 'not-built': '' }
const doc = (over = {}) => ({ file: 'a-layer.md', title: 'A', role: 'Layer 1', version: '0.1.0-draft', date: '2026-01-01', state: 'Built', lastReconciled: 'not reconciled', parts: [{ sections: ['2'], title: 'Two', status: 'built' }], note: '', ...over })
const SPEC = '# A\n\n- **Version:** 0.1.0-draft\n- **Date:** 2026-01-01\n\n## 2. Two\n\ntext\n'

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'spec-status-'))
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t) }
  return root
}

test('the block is added on top and replaced; the rest stays byte for byte', () => {
  const block = renderSpecBlock(doc())
  const once = joinSpec(block, splitSpec(SPEC).rest)
  assert.ok(once.startsWith(BEGIN))
  assert.equal(splitSpec(once).rest, SPEC)
  const again = joinSpec(renderSpecBlock(doc({ state: 'Parked' })), splitSpec(once).rest)
  assert.equal(splitSpec(again).rest, SPEC)
  assert.match(again, /\*\*State:\*\* Parked/)
})

test('a page is replaced between its markers only', () => {
  const page = `x\n${BEGIN}\nold\n${END}\ny\n`
  assert.equal(replaceBetween(page, 'new'), `x\n${BEGIN}\nnew\n${END}\ny\n`)
  assert.equal(replaceBetween('no markers', 'new'), null)
})

test('status.json and spec/ must match, sections and deviations must exist', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'spec/b-layer.md': SPEC, 'lib/DEVIATIONS.md': '| id |\n|---|\n| D1 | x |\n' })
  const errors = checkStatus(root, { statuses: STATUSES, documents: [doc({ parts: [{ sections: ['3'], title: 'Three', status: 'built-differently', ref: ['D9'] }] })] })
  assert.ok(errors.some((e) => e.includes('b-layer.md has no entry')))
  assert.ok(errors.some((e) => e.includes('has no section 3')))
  assert.ok(errors.some((e) => e.includes('D9 is no row')))
  assert.ok(errors.some((e) => e.includes('D1 is named by no part')))
})

test('the version must be the header version', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '' })
  assert.deepEqual(checkStatus(root, { statuses: STATUSES, documents: [doc()] }), [])
  assert.ok(checkStatus(root, { statuses: STATUSES, documents: [doc({ version: '0.2.0-draft' })] }).some((e) => e.includes('header says 0.1.0-draft')))
})
