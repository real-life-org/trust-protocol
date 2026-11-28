import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BEGIN, END, splitSpec, joinSpec, replaceBetween, renderSpecBlock, checkStatus, digestOf, fillStatements, checkStatements, statementUses, renderStatement } from './build-spec-status.mjs'

const STATUSES = { built: '', 'built-differently': '', superseded: '', 'not-built': '' }
const SPEC0 = '# A\n\n- **Version:** 0.1.0-draft\n- **Date:** 2026-01-01\n\n## 2. Two\n\ntext\n'
const doc = (over = {}) => ({ file: 'a-layer.md', title: 'A', role: 'Layer 1', version: '0.1.0-draft', date: '2026-01-01', state: 'Built', lastReconciled: 'not reconciled', textDigest: digestOf(SPEC0), parts: [{ sections: ['2'], title: 'Two', status: 'built', evidence: ['lib/src/x.ts'] }], note: '', ...over })
const SPEC = '# A\n\n- **Version:** 0.1.0-draft\n- **Date:** 2026-01-01\n\n## 2. Two\n\ntext\n'

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'spec-status-'))
  for (const [f, t] of Object.entries({ 'lib/src/x.ts': '// x\n', ...files })) { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t) }
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

test('an edit of a frozen text fails against its digest', () => {
  const root = repo({ 'spec/a-layer.md': SPEC.replace('text', 'edited'), 'lib/DEVIATIONS.md': '' })
  assert.ok(checkStatus(root, { statuses: STATUSES, documents: [doc()] }).some((e) => e.includes('the frozen text has changed')))
})

test('a duplicate entry, a missing source, an empty ref fail', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '' })
  const errors = checkStatus(root, { statuses: STATUSES, documents: [
    doc({ parts: [{ title: 'x', status: 'built', source: 'lib/nonexistent.md (header)' }, { title: 'y', status: 'built-differently', ref: [] }, { title: 'z', status: 'built-differently', ref: '' }] }),
    doc(),
  ] })
  assert.ok(errors.some((e) => e.includes('more than once')))
  assert.ok(errors.some((e) => e.includes('source lib/nonexistent.md does not exist')))
  assert.equal(errors.filter((e) => e.includes('an empty ref')).length, 2)
})

test('a deviation must be named at each document its reading names', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'spec/access-layer.md': SPEC, 'lib/DEVIATIONS.md': '| id | issue | code | since | reading |\n|---|---|---|---|---|\n| D1 | i | c | 0.1 | read against Access 3.6 |\n' })
  const errors = checkStatus(root, { statuses: STATUSES, documents: [
    doc({ parts: [{ title: 'x', status: 'built-differently', ref: ['D1'] }] }),
    doc({ file: 'access-layer.md' }),
  ] })
  assert.ok(errors.some((e) => e.includes('D1 names access-layer.md')))
})

test('a link out of spec/ from a spec block is a repository link', () => {
  const block = renderSpecBlock(doc({ parts: [{ title: 'x', status: 'built-differently', ref: ['D1'] }] }))
  assert.match(block, /\(https:\/\/github\.com\/real-life-org\/trust-protocol\/blob\/main\/lib\/DEVIATIONS\.md\)/)
  assert.doesNotMatch(block, /\(\.\.\/lib\//)
})

test('ref and source read a file path the same way: a missing file fails in both', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '' })
  const errors = checkStatus(root, { statuses: STATUSES, documents: [doc({ parts: [
    { title: 'x', status: 'built-differently', ref: 'lib/nonexistent.ts', evidence: ['lib/src/x.ts'] },
    { title: 'y', status: 'built', source: 'missing.md', evidence: ['lib/src/x.ts'] },
    { title: 'z', status: 'built', source: 'Status of This Document', evidence: ['lib/src/x.ts'] },
  ] })] })
  assert.ok(errors.some((e) => e.includes('ref lib/nonexistent.ts does not exist')))
  assert.ok(errors.some((e) => e.includes('source missing.md does not exist')))
  assert.equal(errors.length, 2)
})

test('a status that is no own key of the legend, and partly-built without a note, fail', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '' })
  const statuses = { ...STATUSES, 'partly-built': '' }
  const errors = checkStatus(root, { statuses, documents: [doc({ parts: [
    { title: 'x', status: 'constructor' },
    { title: 'y', status: 'partly-built' },
    { title: 'z', status: 'partly-built', note: '  ' },
  ] })] })
  assert.ok(errors.some((e) => e.includes('"x"') && e.includes('unknown status constructor')))
  assert.equal(errors.filter((e) => e.includes('partly-built without a note')).length, 2)
})

test('a cited section must be a heading of its own, not the prefix of a child heading', () => {
  const child = '# A\n\n- **Version:** 0.1.0-draft\n- **Date:** 2026-01-01\n\n## 2.1. Child\n\ntext\n\n## 3 Three\n\n### 3a. Letter\n'
  const root = repo({ 'spec/a-layer.md': child, 'lib/DEVIATIONS.md': '' })
  const errors = checkStatus(root, { statuses: STATUSES, documents: [doc({ textDigest: digestOf(child), parts: [{ sections: ['2', '2.1', '3', '3a'], title: 'Two', status: 'built' }] })] })
  assert.ok(errors.some((e) => e.includes('has no section 2')) && !errors.some((e) => e.includes('has no section 2.1')))
  assert.ok(!errors.some((e) => e.includes('has no section 3')))
})

test('exactly one begin and one end marker: a second block on a page or in a spec fails', () => {
  const page = `x\n${BEGIN}\nold\n${END}\ny\n`
  assert.equal(replaceBetween(page + `${BEGIN}\nConverged: all documents\n${END}\n`, 'new'), null)
  assert.equal(replaceBetween(`x\n${END}\n${BEGIN}\n`, 'new'), null)
  const spec = joinSpec(renderSpecBlock(doc()), SPEC) + `\n${BEGIN}\nConverged\n${END}\n`
  const root = repo({ 'spec/a-layer.md': spec, 'lib/DEVIATIONS.md': '' })
  assert.ok(checkStatus(root, { statuses: STATUSES, documents: [doc()] }).some((e) => e.includes('2 begin and 2 end markers')))
})

test('direction-changed needs a ref to an existing note under spec/direction/', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'spec/direction/identity.md': '# note\n', 'lib/DEVIATIONS.md': '' })
  const statuses = { ...STATUSES, 'direction-changed': '' }
  const errors = checkStatus(root, { statuses, documents: [doc({ parts: [
    { title: 'x', status: 'direction-changed', ref: 'typo' },
    { title: 'y', status: 'direction-changed', ref: 'direction/missing.md' },
    { title: 'z', status: 'direction-changed', ref: 'direction/identity.md' },
  ] })] })
  assert.equal(errors.filter((e) => e.includes('direction-changed without a ref')).length, 2)
  assert.ok(!errors.some((e) => e.includes('"z"')))
})

test('a built part needs evidence: existing paths in the library, the vectors or the ceremony definitions', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '' })
  const errors = checkStatus(root, { statuses: STATUSES, documents: [doc({ parts: [
    { sections: ['2'], title: 'none', status: 'built' },
    { sections: ['2'], title: 'missing', status: 'built', evidence: ['lib/test/missing.test.mjs'] },
    { sections: ['2'], title: 'prose', status: 'built', evidence: ['lib/README.md'] },
    { sections: ['2'], title: 'fine', status: 'built', evidence: ['lib/src/x.ts'] },
  ] })] })
  assert.ok(errors.some((e) => e.includes('"none"') && e.includes('no evidence')))
  assert.ok(errors.some((e) => e.includes('evidence lib/test/missing.test.mjs does not exist')))
  assert.ok(errors.some((e) => e.includes('evidence lib/README.md is no path')))
  assert.ok(!errors.some((e) => e.includes('"fine"')))
})

const STMTS = { groups: { short: 'The library runs a `log` ([status](https://x/s.json)).', long: 'Long form.', evidence: ['lib/src/x.ts'] } }

test('a marked place is filled from its statement, inline and as a block, in Markdown, MDX and Astro', () => {
  const md = 'Design. <!-- now:groups -->old<!-- /now:groups --> More.\n\n<!-- now:groups:long -->\nold\n<!-- /now:groups -->\n'
  const r = fillStatements(md, STMTS, 'a.md')
  assert.deepEqual(r.errors, [])
  assert.equal(r.text, 'Design. <!-- now:groups -->The library runs a `log` ([status](https://x/s.json)).<!-- /now:groups --> More.\n\n<!-- now:groups:long -->\nLong form.\n<!-- /now:groups -->\n')
  const mdx = 'Design. {/* now:groups */}{/* /now:groups */}\n'
  assert.equal(fillStatements(mdx, STMTS, 'a.mdx').text, 'Design. {/* now:groups */}' + STMTS.groups.short + '{/* /now:groups */}\n')
  const astro = '<p>Design. <!-- now:groups --><!-- /now:groups --></p>'
  assert.equal(fillStatements(astro, STMTS, 'a.astro').text, '<p>Design. <!-- now:groups -->The library runs a <code>log</code> (<a href="https://x/s.json">status</a>).<!-- /now:groups --></p>')
  assert.deepEqual(statementUses(md, 'a.md'), [{ id: 'groups', form: 'short' }, { id: 'groups', form: 'long' }])
  assert.equal(renderStatement('a < b', 'x.astro'), 'a &lt; b')
})

test('a marker that names no statement or form, a begin without its end, a stray end, a nested begin fail', () => {
  const errs = (t, f = 'a.md') => fillStatements(t, STMTS, f).errors
  assert.ok(errs('x <!-- now:nope --><!-- /now:nope -->').some((e) => e.includes('now:nope names no statement')))
  assert.ok(errs('x <!-- now:groups:medium --><!-- /now:groups -->').some((e) => e.includes('names no form medium')))
  assert.ok(errs('x <!-- now:groups -->text').some((e) => e.includes('no end marker')))
  assert.ok(errs('x <!-- /now:groups -->').some((e) => e.includes('1 end markers for 0 statements')))
  assert.ok(errs('x <!-- now:groups --> <!-- now:groups --><!-- /now:groups -->').some((e) => e.includes('no end marker before the next statement')))
  assert.ok(errs('x {/* now:groups */}', 'a.mdx').some((e) => e.includes('no end marker')))
})

test('every statement is used, has a short form, known fields and existing evidence', () => {
  const root = repo({ 'page.md': 'x <!-- now:groups --><!-- /now:groups -->\n' })
  const statements = { ...STMTS, unused: { short: 'S.', evidence: ['lib/src/x.ts'] }, bad: { long: 'L.', evidence: ['lib/src/none.ts'], extra: 1 } }
  const errors = checkStatements(root, { statements }, ['page.md'])
  assert.ok(errors.some((e) => e.includes('statement unused: used on no page')))
  assert.ok(errors.some((e) => e.includes('statement bad: no short form')))
  assert.ok(errors.some((e) => e.includes('statement bad: unknown field extra')))
  assert.ok(errors.some((e) => e.includes('evidence lib/src/none.ts does not exist')))
  assert.ok(!errors.some((e) => e.includes('statement groups')))
})
