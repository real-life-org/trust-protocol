// Probes for scripts/check-doc-specs.mjs.
//   usage: node --test scripts/check-doc-specs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSpecs, checkDeclarations, pendingPages } from './check-doc-specs.mjs'

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
