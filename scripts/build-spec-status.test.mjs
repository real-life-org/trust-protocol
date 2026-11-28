import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BEGIN, END, splitSpec, joinSpec, replaceBetween, renderSpecBlock, checkStatus, digestOf, fillStatements, checkStatements, statementUses, renderStatement, generate, fileProblem } from './build-spec-status.mjs'

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
    { title: 'x', status: 'built-differently', ref: 'lib/nonexistent.ts', differences: ['lib/src/x.ts'], evidence: ['lib/src/x.ts'] },
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

test('generation runs one text per file through every step: a wrong site table and README are both corrected', () => {
  const SITE = 'apps/site/src/content/docs/reference/specifications.md'
  const root = repo({
    'spec/a-layer.md': SPEC,
    'lib/DEVIATIONS.md': '',
    'README.md': `Design. <!-- now:groups -->stale<!-- /now:groups -->\n\n${BEGIN}\nConverged: all documents\n${END}\n`,
    [SITE]: `---\ntitle: S\nspecs: []\n---\n\n${BEGIN}\n| Converged; its ceremony |\n${END}\n\nMore <!-- now:groups -->stale<!-- /now:groups -->\n`,
  })
  const status = { statuses: STATUSES, statements: STMTS, documents: [doc()] }
  const { errors, outputs } = generate(root, status)
  assert.deepEqual(errors, [])
  const out = Object.fromEntries(outputs.map(([f, , after]) => [f, after]))
  assert.ok(!out[SITE].includes('Converged'), 'the site table is regenerated')
  assert.ok(out[SITE].includes('| Document | Role | Version | State |'))
  assert.ok(out[SITE].includes(`<!-- now:groups -->${STMTS.groups.short}<!-- /now:groups -->`), 'and its statement filled in the same pass')
  assert.ok(!out['README.md'].includes('Converged') && out['README.md'].includes(STMTS.groups.short))
  assert.ok(out['spec/a-layer.md'].startsWith(BEGIN))
  // a second generation over the result changes nothing
  for (const [f, , after] of outputs) writeFileSync(join(root, f), after)
  assert.ok(generate(root, status).outputs.every(([, b, a]) => b === a))
})

test('a path must be a regular file in normal form inside its directory', () => {
  const root = repo({ 'spec/direction/identity.md': '# n\n', 'spec/access-layer.md': '# a\n', 'README.md': '# r\n' })
  assert.equal(fileProblem(root, 'lib/src/x.ts', 'lib/src/'), null)
  assert.match(fileProblem(root, 'lib/src/', 'lib/src/'), /normal form|not a file/)
  assert.match(fileProblem(root, 'lib/src/../../README.md', 'lib/src/'), /normal form/)
  assert.match(fileProblem(root, 'spec/direction/../access-layer.md', 'spec/direction/'), /normal form/)
  assert.match(fileProblem(root, 'spec/direction', 'spec/direction/'), /not under|not a file/)
  const errors = checkStatus(root, { statuses: { ...STATUSES, 'direction-changed': '' }, documents: [] })
  assert.deepEqual(errors.filter((e) => e.includes('direction')), [])
  const ev = checkStatements(root, { statements: { s: { short: 'S.', evidence: ['lib/src/', 'lib/src/../../README.md'] } } }, [])
  assert.equal(ev.filter((e) => e.includes('evidence')).length, 2)
})

test('a direction ref that leaves spec/direction/ fails', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'spec/direction/identity.md': '# n\n', 'spec/access-layer.md': '# a\n', 'lib/DEVIATIONS.md': '' })
  const statuses = { ...STATUSES, 'direction-changed': '' }
  const errors = checkStatus(root, { statuses, documents: [doc({ parts: [{ title: 'x', status: 'direction-changed', ref: 'direction/../access-layer.md' }] })] })
  assert.ok(errors.some((e) => e.includes('direction-changed without a ref')))
})

test('a comment that looks like a statement marker but is none fails', () => {
  const errs = fillStatements('x <!-- now:GROUPS -->old<!-- /now:GROUPS -->', STMTS, 'a.md').errors
  assert.ok(errs.some((e) => e.includes('<!-- now:GROUPS --> is no statement marker')))
  assert.ok(fillStatements('x {/* now:Groups */}old{/* /now:Groups */}', STMTS, 'a.mdx').errors.some((e) => e.includes('is no statement marker')))
})

test('evidence about the app is a file of the public app repository at a fixed commit', () => {
  const root = repo({})
  const ok = 'https://github.com/real-life-org/web-of-trust/blob/b9f61b4daccda51ab10be25d062682c4a7febe94/apps/wot-v3/src/x.ts#L1-L2'
  const errs = (e) => checkStatements(root, { statements: { s: { short: 'S.', evidence: [e] } } }, []).filter((x) => x.includes('evidence'))
  assert.deepEqual(errs(ok), [])
  assert.equal(errs('https://github.com/real-life-org/web-of-trust/blob/main/apps/wot-v3/src/x.ts').length, 1)
})

test('a statement whose markers were removed while its text stayed fails', async () => {
  const long = { groups: { short: 'The library runs a membership log replicated among the members, with founding.', evidence: ['lib/src/x.ts'] } }
  const root = repo({ 'page.md': 'Design. The library runs a membership log replicated among the members, with founding.\n\nx <!-- now:groups --><!-- /now:groups -->\n' })
  assert.ok(checkStatements(root, { statements: long }, ['page.md']).some((e) => e.includes('the statement groups stands without its markers')))
  const { unmarkedAgainstBase } = await import('./check-doc-specs.mjs')
  // against the merge base: the old wording left behind after the markers went
  assert.deepEqual(unmarkedAgainstBase([{ file: 'a.md', text: 'Design. The library runs a membership log replicated among the members, with founding.\n' }], long), [{ file: 'a.md', id: 'groups' }])
  assert.deepEqual(unmarkedAgainstBase([{ file: 'a.md', text: 'Design. <!-- now:groups -->The library runs a membership log replicated among the members, with founding.<!-- /now:groups -->\n' }], long), [])
})

test('an end marker only in the syntax the parser consumes; other marker misuse fails', () => {
  const errs = (t, f = 'a.md') => fillStatements(t, STMTS, f).errors
  // an end that names a form is not consumed
  assert.ok(errs('x <!-- now:groups:long -->a<!-- /now:groups:long -->').some((e) => e.includes('<!-- /now:groups:long --> is no statement marker')))
  assert.ok(errs('x <!-- /now:groups:long -->').some((e) => e.includes('is no statement marker')))
  // the end of another statement inside a place
  assert.ok(errs('x <!-- now:groups --> y <!-- /now:other --> <!-- /now:groups -->').some((e) => e.includes('2 end markers for 1 statements')))
  // an inline place that starts a line would be raw HTML in Markdown
  assert.ok(errs('<!-- now:groups -->old<!-- /now:groups -->\n').some((e) => e.includes('starts a line')))
  assert.deepEqual(errs('<!-- now:groups -->\nold\n<!-- /now:groups -->\n'), [])
})

test('the box: set under the frontmatter of every explaining page with specs, from status.json, exactly once', async () => {
  const { boxPages, renderBox, placeBox, BOX, outsideGenerated } = await import('./build-spec-status.mjs')
  const D = 'apps/site/src/content/docs'
  const status = { statuses: STATUSES, statements: STMTS, documents: [doc()] }
  const root = repo({
    'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '',
    'README.md': `x <!-- now:groups --><!-- /now:groups -->\n\n${BEGIN}\n${END}\n`,
    [`${D}/reference/specifications.md`]: `---\ntitle: S\nspecs: [a-layer]\n---\n\n${BEGIN}\n${END}\n`,
    [`${D}/understand/one.md`]: '---\ntitle: One\nspecs: [a-layer]\n---\n\n## First\n\nText.\n',
    [`${D}/understand/two.mdx`]: "---\ntitle: Two\nspecs: [a-layer]\n---\n\nimport X from './x.astro'\n\nText.\n",
    [`${D}/reference/glossary.mdx`]: '---\ntitle: G\nspecs: []\n---\n\nText.\n',
  })
  assert.deepEqual(boxPages(root).map((p) => p.file), [`${D}/understand/one.md`, `${D}/understand/two.mdx`])
  const box = renderBox(['a-layer'], status, 'x.md')
  assert.match(box, /^<!-- spec-box:begin[^\n]*\n:::note\[Design and status\]\n/)
  assert.ok(box.includes('- [A](https://github.com/real-life-org/trust-protocol/blob/main/spec/a-layer.md): built'))
  assert.ok(!box.includes('<details>'))
  assert.ok(renderBox(['a-layer', 'a-layer', 'a-layer', 'a-layer', 'a-layer'], status, 'x.md').includes('<summary>The 5 specifications this page rests on</summary>'))
  // generation sets the box; a second generation changes nothing
  const { errors, outputs } = generate(root, status)
  assert.deepEqual(errors, [])
  const out = Object.fromEntries(outputs.map(([f, , a]) => [f, a]))
  assert.ok(out[`${D}/understand/one.md`].startsWith('---\ntitle: One\nspecs: [a-layer]\n---\n\n' + BOX.md.begin))
  assert.ok(out[`${D}/understand/two.mdx`].includes("import X from './x.astro'\n\n" + BOX.mdx.begin))
  for (const [f, , a] of outputs) writeFileSync(join(root, f), a)
  assert.ok(generate(root, status).outputs.every(([, b, a]) => b === a))
  // a second box fails; a regenerated box is no human edit
  assert.match(placeBox(`${BOX.md.begin}\n${BOX.md.end}\n${BOX.md.begin}\n${BOX.md.end}\n`, box, 'p.md').error, /2 box begin and 2 box end markers/)
  assert.equal(outsideGenerated(`a\n${BOX.md.begin}\nold\n${BOX.md.end}\nb`, 'p.md'), outsideGenerated(`a\n${BOX.md.begin}\nnew\n${BOX.md.end}\nb`, 'p.md'))
})

test('the box: pages at any depth, the named exception, its place under the frontmatter, no second visible box', async () => {
  const { boxPages, renderBox, placeBox, BOX, BOX_EXCEPTIONS, outsideGenerated } = await import('./build-spec-status.mjs')
  const D = 'apps/site/src/content/docs'
  const root = repo({
    [`${D}/reference/specifications.md`]: '---\ntitle: S\nspecs: [a-layer]\n---\n',
    [`${D}/understand/deep/inner.md`]: '---\ntitle: I\nspecs: [a-layer]\n---\n\nText.\n',
  })
  assert.deepEqual(boxPages(root).map((p) => p.file), [`${D}/understand/deep/inner.md`])
  assert.ok(Object.hasOwn(BOX_EXCEPTIONS, `${D}/reference/specifications.md`))
  const status = { documents: [doc()] }
  const box = renderBox(['a-layer'], status, 'p.md')
  const fm = '---\ntitle: P\nspecs: [a-layer]\n---\n'
  // the unchanged box at the end of the page
  assert.match(placeBox(`${fm}\n## First\n\nText.\n\n${box}\n`, box, 'p.md').error, /does not stand directly under the frontmatter/)
  // a second visible copy without markers
  const copy = box.split('\n').slice(1, -1).join('\n')
  assert.match(placeBox(`${fm}\n${box}\n\n${copy}\n`, box, 'p.md').error, /a second box stands outside the markers/)
  assert.match(placeBox(`${fm}\n${copy}\n`, box, 'p.md').error, /a box stands without its markers/)
  // the first setting of a box is no edit of a person
  const without = `${fm}\n## First\n\nText.\n`
  const withBox = placeBox(without, box, 'p.md').text
  assert.equal(outsideGenerated(withBox, 'p.md'), outsideGenerated(without, 'p.md'))
})

test('a statement left behind with a line break in it is still found', () => {
  const long = { groups: { short: 'The library runs a membership log replicated among the members, with founding.', evidence: ['lib/src/x.ts'] } }
  const root = repo({ 'page.md': 'Design. The library runs a membership log replicated\namong the members, with founding.\n\nx <!-- now:groups --><!-- /now:groups -->\n' })
  assert.ok(checkStatements(root, { statements: long }, ['page.md']).some((e) => e.includes('the statement groups stands without its markers')))
})

test('a count in the state is the count of the parts', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '' })
  const statuses = { ...STATUSES, 'partly-built': '' }
  const parts = [{ sections: ['2'], title: 'x', status: 'partly-built', note: 'n', evidence: ['lib/src/x.ts'] }]
  assert.ok(checkStatus(root, { statuses, documents: [doc({ state: 'Mostly built; two in part', parts })] }).some((e) => e.includes('the state says two in part, the parts have 1')))
  assert.ok(!checkStatus(root, { statuses, documents: [doc({ state: 'Mostly built; one in part', parts })] }).some((e) => e.includes('the state says')))
})

test('a box on a page that gets none, and specs naming no entry, fail', async () => {
  const { strayBoxes, BOX } = await import('./build-spec-status.mjs')
  const D = 'apps/site/src/content/docs'
  const root = repo({
    'spec/a-layer.md': SPEC, 'spec/direction/identity.md': '# n\n', 'lib/DEVIATIONS.md': '',
    'README.md': `x <!-- now:groups --><!-- /now:groups -->\n\n${BEGIN}\n${END}\n`,
    'apps/site/src/content/docs/reference/specifications.md': `---\ntitle: S\nspecs: []\n---\n\n${BEGIN}\n${END}\n`,
    [`${D}/understand/none.md`]: `---\ntitle: N\nspecs: []\n---\n\n${BOX.md.begin}\n:::note[Design and status]\nold\n:::\n${BOX.md.end}\n\nText.\n`,
    [`${D}/understand/odd.md`]: '---\ntitle: O\nspecs: [b-layer]\n---\n\nText.\n',
    'spec/b-layer.md': '# b\n',
  })
  assert.deepEqual(strayBoxes(root), [`${D}/understand/none.md`])
  const { errors } = generate(root, { statuses: STATUSES, statements: STMTS, documents: [doc()] })
  assert.ok(errors.some((e) => e.includes('none.md: a box on a page that gets none')))
  assert.ok(errors.some((e) => e.includes('odd.md: specs names b-layer, which has no entry')))
})

test('setting a box is no edit of a person, whatever the space after the frontmatter or the imports', async () => {
  const { renderBox, placeBox, outsideGenerated } = await import('./build-spec-status.mjs')
  const box = renderBox(['a-layer'], { documents: [doc()] }, 'p.md')
  for (const page of ['---\ntitle: P\nspecs: [a-layer]\n---\nFirst paragraph.\n', '---\ntitle: P\nspecs: [a-layer]\n---\n\n\nFirst paragraph.\n']) {
    assert.equal(outsideGenerated(placeBox(page, box, 'p.md').text, 'p.md'), outsideGenerated(page, 'p.md'))
  }
  const mdxBox = renderBox(['a-layer'], { documents: [doc()] }, 'p.mdx')
  for (const page of ["---\ntitle: P\nspecs: [a-layer]\n---\nimport X from './x'\nText.\n", "---\ntitle: P\nspecs: [a-layer]\n---\n\nimport X from './x'\n\n\nText.\n"]) {
    assert.equal(outsideGenerated(placeBox(page, mdxBox, 'p.mdx').text, 'p.mdx'), outsideGenerated(page, 'p.mdx'))
  }
})

test('differences point to a row of lib/DEVIATIONS.md, the header of a source file or a test, and must exist', async () => {
  const { renderDifferences } = await import('./build-spec-status.mjs')
  const root = repo({
    'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '| id | issue | code | since | reading |\n|---|---|---|---|---|\n| D1 | i | c | 0.1 | read |\n',
    'lib/test/t.test.mjs': "test('one-sided chaining: a case', () => {})\n",
  })
  const statuses = { ...STATUSES, 'partly-built': '' }
  const ok = [{ sections: ['2'], title: 'x', status: 'built-differently', differences: ['D1', 'lib/src/x.ts', 'lib/test/t.test.mjs#one-sided chaining'], evidence: ['lib/src/x.ts'] }]
  assert.deepEqual(checkStatus(root, { statuses, documents: [doc({ parts: ok })] }), [])
  const bad = [
    { sections: ['2'], title: 'none', status: 'built-differently', evidence: ['lib/src/x.ts'] },
    { sections: ['2'], title: 'd9', status: 'built-differently', differences: ['D9'], evidence: ['lib/src/x.ts'] },
    { sections: ['2'], title: 'path', status: 'built-differently', differences: ['lib/src/missing.ts'], evidence: ['lib/src/x.ts'] },
    { sections: ['2'], title: 'test', status: 'built-differently', differences: ['lib/test/t.test.mjs#no such test'], evidence: ['lib/src/x.ts'] },
    { sections: ['2'], title: 'outside', status: 'built-differently', differences: ['README.md'], evidence: ['lib/src/x.ts'] },
  ]
  const errors = checkStatus(root, { statuses, documents: [doc({ parts: bad })] })
  assert.ok(errors.some((e) => e.includes('"none": built-differently without differences')))
  assert.ok(errors.some((e) => e.includes('D9 is no row')))
  assert.ok(errors.some((e) => e.includes('difference lib/src/missing.ts does not exist')))
  assert.ok(errors.some((e) => e.includes('has 0 tests whose name starts "no such test", not one')))
  assert.ok(errors.some((e) => e.includes('difference README.md is not under lib/src/')))
  assert.equal(renderDifferences(ok[0], 'root'), 'Differences: [D1](lib/DEVIATIONS.md), the header of [`lib/src/x.ts`](lib/src/x.ts), test `one-sided chaining` in [`t.test.mjs`](lib/test/t.test.mjs).')
})

test('a box inside the frontmatter, and an import over several lines, are refused', async () => {
  const { renderBox, placeBox } = await import('./build-spec-status.mjs')
  const box = renderBox(['a-layer'], { documents: [doc()] }, 'p.md')
  const inYaml = `---\ntitle: P\ndescription: |\n  ${box.split('\n').join('\n  ')}\nspecs: [a-layer]\n---\n\nText.\n`
  assert.match(placeBox(inYaml, box, 'p.md').error, /a box marker stands inside the frontmatter/)
  const mdxBox = renderBox(['a-layer'], { documents: [doc()] }, 'p.mdx')
  const multi = "---\ntitle: P\nspecs: [a-layer]\n---\n\nimport {\n  A,\n  B,\n} from './x'\n\nText.\n"
  assert.match(placeBox(multi, mdxBox, 'p.mdx').error, /an import over several lines/)
  assert.equal(placeBox("---\ntitle: P\nspecs: [a-layer]\n---\n\nimport { A, B } from './x'\n\nText.\n", mdxBox, 'p.mdx').error, undefined)
})

test('a statement about the app needs a pinned app permalink; a test reference needs one test name found once', () => {
  const root = repo({ 'spec/a-layer.md': SPEC, 'lib/DEVIATIONS.md': '', 'lib/test/t.test.mjs': "test('alpha one', () => {})\ntest('alpha two', () => {})\n", 'page.md': 'x <!-- now:s --><!-- /now:s -->\n' })
  const app = 'https://github.com/real-life-org/web-of-trust/blob/b9f61b4daccda51ab10be25d062682c4a7febe94/apps/wot-v3/src/x.ts#L1-L2'
  const say = (evidence) => checkStatements(root, { statements: { s: { short: 'The library and the app run a log.', evidence } } }, ['page.md'])
  assert.ok(say(['lib/src/x.ts']).some((e) => e.includes('speaks of the app without a pinned app permalink')))
  assert.ok(!say(['lib/src/x.ts', app]).some((e) => e.includes('speaks of the app')))
  const part = (differences) => checkStatus(root, { statuses: STATUSES, documents: [doc({ parts: [{ sections: ['2'], title: 'x', status: 'built-differently', differences, evidence: ['lib/src/x.ts'] }] })] })
  assert.ok(part(['lib/test/t.test.mjs']).some((e) => e.includes('names no test')))
  assert.ok(part(['lib/test/t.test.mjs#alpha']).some((e) => e.includes('has 2 tests whose name starts "alpha", not one')))
  assert.ok(part(['lib/src/x.ts#alpha']).some((e) => e.includes('takes no test name')))
  assert.deepEqual(part(['lib/test/t.test.mjs#alpha one']), [])
})
