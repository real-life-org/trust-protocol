// Probes for scripts/check-doc-specs.mjs.
//   usage: node --test scripts/check-doc-specs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { parseSpecs, parseLibrary, checkDeclarations, pendingPages, changedStatusEntries } from './check-doc-specs.mjs'

const DOCS = 'apps/site/src/content/docs'
const page = (specs) => `---\ntitle: T\ndescription: D\n${specs === undefined ? '' : `specs: ${specs}\n`}---\n\nBody with specs: [not, frontmatter]\n`

const repo = (pages, specFiles = ['access-layer', 'trust-layer', 'membership-tasks']) => {
  const root = mkdtempSync(join(tmpdir(), 'docspecs-'))
  mkdirSync(join(root, 'spec/archive'), { recursive: true })
  for (const s of specFiles) writeFileSync(join(root, 'spec', `${s}.md`), `# ${s}\n`)
  for (const [path, text] of Object.entries(pages)) {
    mkdirSync(join(root, DOCS, path, '..'), { recursive: true })
    writeFileSync(join(root, DOCS, path), text)
  }
  return root
}

test('the specs list is read from the frontmatter only', () => {
  assert.deepEqual(parseSpecs(page('[access-layer, trust-layer]')), ['access-layer', 'trust-layer'])
  assert.deepEqual(parseSpecs(page('[]')), [])
  assert.equal(parseSpecs(page(undefined)), null)
})

test('every page declares its specs, and only specifications that exist', () => {
  const root = repo({
    'understand/groups.md': page('[access-layer, membership-tasks]'),
    'get-started/try-it.md': page('[]'),
    'understand/trust.md': page(undefined),
    'reference/tasks.mdx': page('[access-layer, delivery-contract]'),
  })
  assert.deepEqual(checkDeclarations(root).map((e) => [e.file, e.msg]), [
    [`${DOCS}/reference/tasks.mdx`, 'specs names delivery-contract, which is no specification in spec/'],
    [`${DOCS}/understand/trust.md`, 'no specs: in the frontmatter (use [] for a page that rests on no specification)'],
  ])
})

test('a changed specification makes its pages pending unless the same change touches them', () => {
  const root = repo({
    'understand/groups.md': page('[access-layer, membership-tasks]'),
    'understand/group-keys.md': page('[access-layer]'),
    'understand/trust.md': page('[trust-layer]'),
    'get-started/try-it.md': page('[]'),
  })
  const changed = ['spec/access-layer.md', `${DOCS}/understand/group-keys.md`, 'spec/archive/access-layer-0.56.md', 'README.md']
  assert.deepEqual(pendingPages(root, changed), [
    { file: `${DOCS}/understand/groups.md`, specs: ['access-layer'] },
  ])
})

test('no changed specification, nothing pending', () => {
  const root = repo({ 'understand/groups.md': page('[access-layer]') })
  assert.deepEqual(pendingPages(root, ['spec/archive/access-layer-0.56.md', `${DOCS}/understand/groups.md`]), [])
})

// ── the repository's own mapping ────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pendingFor = (spec) => pendingPages(ROOT, [`spec/${spec}.md`]).map((p) => p.file.slice(DOCS.length + 1))

test('pages that state protocol rules are pending when those specifications change', () => {
  for (const spec of ['encounter-layer', 'identity-layer', 'trust-layer', 'access-layer', 'membership-tasks', 'replication-contract', 'delivery-contract']) {
    assert.ok(pendingFor(spec).includes('understand/why.mdx'), `why.mdx for ${spec}`)
  }
  for (const spec of ['encounter-layer', 'trust-layer', 'access-layer', 'membership-tasks', 'delivery-contract']) {
    assert.ok(pendingFor(spec).includes('get-started/try-it.md'), `try-it.md for ${spec}`)
  }
  assert.ok(pendingFor('encounter-layer').includes('get-started/implement.md'))
})

test('pages that list registered task types are pending when a registering specification changes', () => {
  for (const spec of ['delivery-contract', 'membership-tasks', 'message-tasks', 'trust-layer', 'access-layer']) {
    for (const page of ['understand/foundations.md', 'reference/trust-tasks.md']) {
      assert.ok(pendingFor(spec).includes(page), `${page} for ${spec}`)
    }
  }
})

test('only the generated glossary rests on no specification', () => {
  const none = []
  for (const dir of ['understand', 'get-started', 'reference']) {
    for (const f of readdirSync(join(ROOT, DOCS, dir))) {
      if (parseSpecs(readFileSync(join(ROOT, DOCS, dir, f), 'utf8'))?.length === 0) none.push(`${dir}/${f}`)
    }
  }
  assert.deepEqual(none, ['reference/glossary.mdx'])
})

// ── library releases ────────────────────────────────────────────────────

const libPage = (specs, flag) => page(specs).replace('---\n\n', `library: ${flag}\n---\n\n`)

test('library: true in the frontmatter marks a page that describes the library', () => {
  assert.equal(parseLibrary(libPage('[]', 'true')), true)
  assert.equal(parseLibrary(page('[]')), false)
  const root = repo({ 'get-started/implement.md': libPage('[]', 'yes') })
  assert.deepEqual(checkDeclarations(root).map((e) => e.msg), ['library: must be true or false'])
})

test('a library release makes the library pages pending unless the same change touches them', () => {
  const root = repo({
    'get-started/implement.md': libPage('[trust-layer]', 'true'),
    'get-started/other.md': libPage('[]', 'true'),
    'understand/groups.md': page('[access-layer]'),
  })
  const changed = ['lib/package.json', `${DOCS}/get-started/other.md`]
  assert.deepEqual(pendingPages(root, changed, { release: true }), [
    { file: `${DOCS}/get-started/implement.md`, specs: [], library: true },
  ])
  assert.deepEqual(pendingPages(root, changed, { release: false }), [])
  assert.deepEqual(pendingPages(root, ['spec/trust-layer.md'], { release: true }), [
    { file: `${DOCS}/get-started/implement.md`, specs: ['trust-layer'], library: true },
    { file: `${DOCS}/get-started/other.md`, specs: [], library: true },
  ])
})

test('the Implement page follows every library release', () => {
  assert.ok(pendingPages(ROOT, ['lib/package.json'], { release: true }).some((p) => p.file.endsWith('get-started/implement.md')))
})

test('a changed entry in spec/status.json counts as a change of its specification', () => {
  const entry = (state, digest = 'sha256:a') => ({ file: 'access-layer.md', title: 'Access', state, textDigest: digest, parts: [] })
  const status = (...docs) => JSON.stringify({ documents: docs })
  const other = { file: 'trust-layer.md', state: 'Built', parts: [] }
  // built -> superseded: the specification counts as changed, its pages are pending
  const changed = changedStatusEntries(status(entry('Built'), other), status(entry('Superseded'), other))
  assert.deepEqual(changed, ['spec/access-layer.md'])
  const root = repo({ 'understand/groups.md': page('[access-layer]'), 'understand/trust.md': page('[trust-layer]') })
  assert.deepEqual(pendingPages(root, changed).map((p) => p.file), [`${DOCS}/understand/groups.md`])
  // the digest alone does not count; an unchanged entry does not count
  assert.deepEqual(changedStatusEntries(status(entry('Built', 'sha256:a')), status(entry('Built', 'sha256:b'))), [])
  // a new or removed entry counts; no file before counts every entry
  assert.deepEqual(changedStatusEntries(null, status(entry('Built'), other)), ['spec/access-layer.md', 'spec/trust-layer.md'])
  assert.deepEqual(changedStatusEntries(status(entry('Built'), other), status(other)), ['spec/access-layer.md'])
})

test('a changed statement makes the pages that carry it pending; its evidence does not count', async () => {
  const { changedStatements } = await import('./check-doc-specs.mjs')
  const before = JSON.stringify({ statements: { groups: { short: 'A log.', evidence: ['lib/src/a.ts'] }, identity: { short: 'Seed.', evidence: ['lib/src/b.ts'] } } })
  const after = JSON.stringify({ statements: { groups: { short: 'A log, no removal.', evidence: ['lib/src/a.ts'] }, identity: { short: 'Seed.', evidence: ['lib/src/c.ts'] } } })
  assert.deepEqual(changedStatements(before, after), ['groups'])
  const root = repo({
    'understand/groups.md': page('[]').replace('Body', 'Design. <!-- now:groups -->A log.<!-- /now:groups --> Body'),
    'understand/why.mdx': page('[]').replace('Body', 'Design. {/* now:groups */}A log.{/* /now:groups */} Body'),
    'understand/trust.md': page('[]').replace('Body', 'x <!-- now:identity -->Seed.<!-- /now:identity --> Body'),
  })
  const pending = pendingPages(root, ['spec/status.json'], { statements: ['groups'] })
  assert.deepEqual(pending.map((p) => p.file), [`${DOCS}/understand/groups.md`, `${DOCS}/understand/why.mdx`])
  assert.deepEqual(pending[0].statements, ['groups'])
  // a page the same change touches is not pending
  assert.deepEqual(pendingPages(root, ['spec/status.json', `${DOCS}/understand/groups.md`], { statements: ['groups'] }).map((p) => p.file), [`${DOCS}/understand/why.mdx`])
})

test('a page the change touched only inside generated places stays pending for a changed statement', async () => {
  const { outsideGenerated } = await import('./build-spec-status.mjs')
  const before = 'Design. <!-- now:group-conflicts -->Old.<!-- /now:group-conflicts --> More.\n'
  const after = 'Design. <!-- now:group-conflicts -->New.<!-- /now:group-conflicts --> More.\n'
  assert.equal(outsideGenerated(before, 'a.md'), outsideGenerated(after, 'a.md'))
  assert.notEqual(outsideGenerated(after.replace('More', 'Read'), 'a.md'), outsideGenerated(before, 'a.md'))
  const root = repo({ 'understand/groups.md': page('[]').replace('Body', after) })
  const file = `${DOCS}/understand/groups.md`
  // regenerated only: changed, but not touched by a person
  assert.deepEqual(pendingPages(root, ['spec/status.json', file], { statements: ['group-conflicts'], touched: ['spec/status.json'] }).map((p) => p.file), [file])
  assert.deepEqual(pendingPages(root, ['spec/status.json', file], { statements: ['group-conflicts'], touched: ['spec/status.json', file] }), [])
})

test('specs names an entry of spec/status.json, not just a file under spec/', () => {
  const root = repo({ 'understand/a.md': page('[access-layer]'), 'understand/b.md': page('[trust-layer]'), 'understand/c.md': page('[direction/identity]') })
  writeFileSync(join(root, 'spec/status.json'), JSON.stringify({ documents: [{ file: 'access-layer.md' }] }))
  const errors = checkDeclarations(root)
  assert.ok(errors.some((e) => e.file.endsWith('b.md') && e.msg.includes('no entry in spec/status.json')))
  assert.ok(errors.some((e) => e.file.endsWith('c.md') && e.msg.includes('no specification')))
  assert.ok(!errors.some((e) => e.file.endsWith('a.md')))
})

test('the order keys are written in is no change of a status entry', async () => {
  const { changedStatusEntries } = await import('./check-doc-specs.mjs')
  const a = JSON.stringify({ documents: [{ file: 'access-layer.md', title: 'Access', state: 'Built', parts: [{ title: 'x', status: 'built' }] }] })
  const b = JSON.stringify({ documents: [{ state: 'Built', file: 'access-layer.md', parts: [{ status: 'built', title: 'x' }], title: 'Access' }] })
  assert.deepEqual(changedStatusEntries(a, b), [])
  const c = JSON.stringify({ documents: [{ file: 'access-layer.md', title: 'Access', state: 'Built', parts: [{ title: 'y', status: 'built' }, { title: 'x', status: 'built' }] }] })
  assert.deepEqual(changedStatusEntries(a, c), ['spec/access-layer.md'], 'the order of parts still counts')
})
