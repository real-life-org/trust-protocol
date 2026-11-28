// Probes for scripts/build-spec-status.mjs, one rule each.
//   usage: node --test scripts/build-spec-status.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { validateForm, checkRegister, regions, fill, generate, frozenText, digestOf } from './build-spec-status.mjs'

const SITE = 'apps/site/src/content/docs/reference/specifications.md'
const SPEC = '# A Layer\n\n- **Version:** 0.1.0-draft\n- **Date:** 2026-01-01\n\n## 1. Intro\n\n## 2a. More\n'

// A repository with one specification and every kind of region.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spec-status-'))
  const files = {
    'spec/a-layer.md': `<!-- spec-status -->\nold\n<!-- /spec-status -->\n\n${SPEC}`,
    'spec/direction/a.md': 'Today: <!-- now:s1 -->old<!-- /now:s1 -->\n',
    'lib/DEVIATIONS.md': '| id | issue |\n|---|---|\n| D1 | x |\n',
    'lib/src/x.ts': '// x\n',
    'lib/test/x.test.mjs': "test('one thing works', () => {})\n",
    'README.md': '# R\n\n<!-- spec-status -->\nold\n<!-- /spec-status -->\n\n<!-- now:s1:long -->\nold\n<!-- /now:s1 -->\n',
    [SITE]: '---\ntitle: S\nspecs: [a-layer]\n---\n\n<!-- spec-status -->\n<!-- /spec-status -->\n',
    'apps/site/src/content/docs/understand/p.md': '---\ntitle: P\nspecs: [a-layer]\n---\n\n<!-- spec-box -->\n<!-- /spec-box -->\n\nText.\n',
  }
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(root, dirname(f)), { recursive: true }); writeFileSync(join(root, f), t) }
  return root
}

const STATUSES = Object.fromEntries(['built', 'partly-built', 'built-differently', 'not-built', 'superseded', 'parked', 'direction-changed', 'not-verified'].map((s) => [s, s]))
const register = () => ({
  statuses: { ...STATUSES },
  statements: { s1: { short: 'Short.', long: 'Long.', evidence: ['lib/src/x.ts'] } },
  documents: [{
    file: 'a-layer.md', title: 'A Layer', role: 'Layer 1', version: '0.1.0-draft', date: '2026-01-01',
    state: 'Built; one in part', lastReconciled: 'not reconciled', direction: 'direction/a.md', textDigest: digestOf(SPEC),
    parts: [
      { sections: ['1'], title: 'Intro', status: 'built', evidence: ['lib/src/x.ts'] },
      { sections: ['2a'], title: 'More', status: 'partly-built', note: 'Half.', differences: ['D1', 'lib/test/x.test.mjs#one thing'], evidence: ['lib/test/x.test.mjs'] },
    ],
  }],
})
const part = (r, i) => r.documents[0].parts[i]
const errorsWith = (root, change) => { const r = register(); change(r); return checkRegister(root, r) }

test('the schema refuses a register of the wrong form, with the path of the fault', () => {
  assert.deepEqual(validateForm(register()), [])
  const cases = [
    [(r) => { part(r, 0).status = 'done' }, '/documents/0/parts/0/status'],
    [(r) => { part(r, 0).status = 'built-differently' }, "/documents/0/parts/0: must have required property 'differences'"],
    [(r) => { delete part(r, 1).note; delete part(r, 1).differences }, "/documents/0/parts/1: must have required property 'note'"],
    [(r) => { part(r, 0).status = 'superseded' }, "/documents/0/parts/0: must have required property 'target'"],
    [(r) => { Object.assign(part(r, 0), { status: 'superseded', target: 'lib/src/x.ts', direction: 'direction/a.md' }) }, '/documents/0/parts/0: must NOT be valid'],
    [(r) => { part(r, 0).status = 'direction-changed' }, "/documents/0/parts/0: must have required property 'direction'"],
    [(r) => { delete part(r, 0).evidence }, "/documents/0/parts/0: must have required property 'evidence'"],
    [(r) => { part(r, 0).evidence = ['lib/README.md'] }, '/documents/0/parts/0/evidence: must contain at least 1 valid item'],
    [(r) => { part(r, 1).differences = ['lib/test/x.test.mjs'] }, '/documents/0/parts/1/differences/0: must match pattern'],
    [(r) => { part(r, 0).target = '../outside.md' }, '/documents/0/parts/0/target: must match pattern'],
    [(r) => { delete r.statements.s1.evidence }, "/statements/s1: must have required property 'evidence'"],
    [(r) => { r.documents[0].textDigest = 'abc' }, '/documents/0/textDigest: must match pattern'],
  ]
  for (const [change, expected] of cases) {
    const r = register(); change(r)
    assert.ok(validateForm(r).some((e) => e.includes(expected)), `${expected} in ${validateForm(r).join('; ')}`)
  }
})

test('every specification has exactly one entry and every entry a file', () => {
  const root = fixture()
  writeFileSync(join(root, 'spec/b-layer.md'), SPEC)
  assert.deepEqual(errorsWith(root, (r) => r.documents.push({ ...r.documents[0], file: 'c-layer.md' })), [
    'spec/b-layer.md: not exactly one entry in spec/status.json',
    'spec/status.json names c-layer.md, which is not in spec/',
  ])
})

test('version and date are those of the header', () => {
  assert.deepEqual(errorsWith(fixture(), (r) => { r.documents[0].version = '0.2.0-draft'; r.documents[0].date = '2026-02-02' }), [
    'spec/status.json a-layer.md: version 0.2.0-draft, the header says 0.1.0-draft',
    'spec/status.json a-layer.md: date 2026-02-02, the header says 2026-01-01',
  ])
})

test('the frozen text below the status block has the named digest', () => {
  const root = fixture()
  writeFileSync(join(root, 'spec/a-layer.md'), `<!-- spec-status -->\nanother block\n<!-- /spec-status -->\n\n${SPEC}`)
  assert.deepEqual(checkRegister(root, register()), [])
  writeFileSync(join(root, 'spec/a-layer.md'), `<!-- spec-status -->\n<!-- /spec-status -->\n\n${SPEC}edited\n`)
  assert.match(checkRegister(root, register()).join('\n'), /a-layer\.md: the frozen text has changed/)
})

test('a named section is a heading of the specification, by its whole number', () => {
  assert.deepEqual(errorsWith(fixture(), (r) => { part(r, 0).sections = ['2', '3'] }), [
    'spec/status.json a-layer.md "Intro": spec/a-layer.md has no section 2',
    'spec/status.json a-layer.md "Intro": spec/a-layer.md has no section 3',
  ])
})

test('every named path is a file, and a named test occurs in its file', () => {
  assert.deepEqual(checkRegister(fixture(), register()), [])
  assert.deepEqual(errorsWith(fixture(), (r) => {
    part(r, 0).evidence.push('lib/src/gone.ts'); part(r, 0).target = 'interop/gone.json'
    r.documents[0].direction = 'direction/gone.md'; r.statements.s1.evidence.push('vectors/gone.json')
    part(r, 1).differences = ['D1', 'lib/test/x.test.mjs#another thing']
  }), [
    'statement s1: vectors/gone.json is no file',
    'spec/status.json a-layer.md: spec/direction/gone.md is no file',
    'spec/status.json a-layer.md "Intro": lib/src/gone.ts is no file',
    'spec/status.json a-layer.md "Intro": interop/gone.json is no file',
    'spec/status.json a-layer.md "More": lib/test/x.test.mjs has no test whose name starts "another thing"',
  ])
})

test('every deviation named is a row of lib/DEVIATIONS.md, and every row is named', () => {
  assert.deepEqual(errorsWith(fixture(), (r) => { part(r, 1).differences = ['D9'] }), [
    'spec/status.json a-layer.md "More": D9 is no row of lib/DEVIATIONS.md',
    'lib/DEVIATIONS.md D1 is named by no part in spec/status.json',
  ])
})

test('a count the state names is the count of the parts', () => {
  assert.deepEqual(errorsWith(fixture(), (r) => { r.documents[0].state = 'Built; two in part' }), [
    'spec/status.json a-layer.md: the state says two in part, the parts have 1',
  ])
})

test('regions are filled in one pass; a stray end, a nested begin, a missing end and an unknown id are errors', () => {
  const body = (r) => (r.id === 'gone' ? { error: 'no statement gone' } : `<${r.kind}>`)
  assert.deepEqual(fill('a <!-- now:x -->old<!-- /now:x --> b\n<!-- spec-box -->\nold\n<!-- /spec-box -->\n', 'p.md', body),
    { text: 'a <!-- now:x --><now><!-- /now:x --> b\n<!-- spec-box -->\n<spec-box>\n<!-- /spec-box -->\n', errors: [] })
  assert.equal(fill('{/* now:x */}old{/* /now:x */}', 'p.mdx', body).text, '{/* now:x */}<now>{/* /now:x */}')
  assert.deepEqual(regions('<!-- /now:x --> <!-- now:x --><!-- spec-box --><!-- /now:x --> <!-- now:y -->', 'p.md').errors, [
    'p.md: <!-- /now:x --> closes no open region',
    'p.md: <!-- spec-box --> opens inside <!-- now:x -->',
    'p.md: <!-- now:y --> has no end marker',
  ])
  assert.deepEqual(fill('<!-- now:gone --><!-- /now:gone -->', 'p.md', body).errors, ['p.md: <!-- now:gone -->: no statement gone'])
  assert.equal(frozenText('<!-- spec-status -->\nx\n<!-- /spec-status -->\n\nbody\n'), 'body\n')
})

test('a region the file has no place for, or a box page without its box, is an error', () => {
  const root = fixture()
  writeFileSync(join(root, 'spec/direction/a.md'), '<!-- spec-box -->\n<!-- /spec-box -->\n<!-- now:s1:wide -->x<!-- /now:s1 -->\n')
  writeFileSync(join(root, 'apps/site/src/content/docs/understand/p.md'), '---\ntitle: P\nspecs: [a-layer]\n---\n\nText.\n')
  assert.deepEqual(generate(root, register()).errors, [
    'spec/direction/a.md: <!-- spec-box -->: no such region in spec/direction/a.md',
    'spec/direction/a.md: <!-- now:s1:wide -->: no statement s1 with a wide form in spec/status.json',
    'apps/site/src/content/docs/understand/p.md: not exactly one spec-box region',
  ])
})

test('generating is idempotent, and a file that differs from what it generates is stale', () => {
  const root = fixture()
  const stale = () => [...generate(root, register()).outputs].filter(([f, t]) => readFileSync(join(root, f), 'utf8') !== t).map(([f]) => f)
  for (const [f, t] of generate(root, register()).outputs) writeFileSync(join(root, f), t)
  assert.deepEqual(stale(), [])
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  assert.match(readme, /<!-- now:s1:long -->\nLong\.\n<!-- \/now:s1 -->/)
  writeFileSync(join(root, 'README.md'), readme.replace('Long.', 'Long, edited by hand.'))
  assert.deepEqual(stale(), ['README.md'])
})
