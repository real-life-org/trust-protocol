// Probes for scripts/check-doc-refs.mjs.
//   usage: node --test scripts/check-doc-refs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { slugify, anchorsOf, findAnchorLinks, checkAnchors, checkVersions } from './check-doc-refs.mjs'
import { SPECS } from './check-companion-pins.mjs'

const S = 'spec/' // keeps this file's own strings out of the repository-wide scan

// ── slugs as GitHub forms them ──────────────────────────────────────────

test('section numbers lose their dots, punctuation goes, spaces become hyphens', () => {
  assert.equal(slugify('5.3 Challenges'), '53-challenges')
  assert.equal(slugify('3. What an encounter establishes'), '3-what-an-encounter-establishes')
  assert.equal(slugify('4.4 The enacting anchor: fresh, always (normative)'), '44-the-enacting-anchor-fresh-always-normative')
})

test('inline code keeps its text and its underscores; emphasis markers go', () => {
  assert.equal(slugify('The `encounter-scan` ceremony'), 'the-encounter-scan-ceremony')
  assert.equal(slugify('`key_id` and _the_ **rule**'), 'key_id-and-the-rule')
})

test('a link keeps its text, an HTML tag goes, letters beyond ASCII stay', () => {
  assert.equal(slugify('[RFC 8785](https://example.org/rfc8785) canonical form'), 'rfc-8785-canonical-form')
  assert.equal(slugify('Key delivery<sup>0.1</sup>'), 'key-delivery01')
  assert.equal(slugify('Größe — Übersicht'), 'größe--übersicht')
})

// ── anchors of a document ───────────────────────────────────────────────

test('repeated headings count up, fenced code is no heading, closing hashes go', () => {
  const md = '# Title\n\n## Notes\n\n```md\n## Not a heading\n```\n\n## Notes ##\n\n<a id="custom-anchor"></a>\n'
  assert.deepEqual([...anchorsOf(md)].sort(), ['custom-anchor', 'notes', 'notes-1', 'title'])
})

// ── links into the specifications ───────────────────────────────────────

test('every form of a link into a specification section is found, with its line', () => {
  const text = [
    `[a](https://github.com/real-life-org/trust-protocol/blob/main/${S}access-layer.md#3-the-authority-log)`,
    `see ../${S}trust-layer.md#5-stars and /${S}encounter-layer.md#gr%C3%B6%C3%9Fe`,
    `"source": "${S}identity-layer.md#54-the-community-anchors-generations"`,
    `${S}archive/access-layer-0.53.md#old is history, not checked`,
    `https://github.com/real-life-org/wot-spec/blob/main/${S}sync.md#other is another repository`,
  ].join('\n')
  assert.deepEqual(findAnchorLinks(text).map((l) => [l.spec, l.anchor, l.line]), [
    ['access-layer.md', '3-the-authority-log', 1],
    ['trust-layer.md', '5-stars', 2],
    ['encounter-layer.md', 'größe', 2],
    ['identity-layer.md', '54-the-community-anchors-generations', 3],
  ])
})

const repo = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'docrefs-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test('a link to an existing section passes; a renamed section and a missing file fail, with file and line', () => {
  const root = repo({
    [`${S}access-layer.md`]: '# Access\n\n## 3. The authority log\n',
    'docs/groups.md': `intro\n[log](${S}access-layer.md#3-the-authority-log)\n[policy](${S}access-layer.md#4-policy)\n[x](${S}gone.md#a)\n`,
  })
  const errors = checkAnchors(root, ['docs/groups.md'])
  assert.deepEqual(errors.map((e) => [e.file, e.line]), [['docs/groups.md', 3], ['docs/groups.md', 4]])
  assert.match(errors[0].msg, /access-layer\.md has no section #4-policy/)
  assert.match(errors[1].msg, /gone\.md does not exist/)
})

// ── versions named outside the specifications ───────────────────────────

const head = (v) => `# Spec\n\n- **Version:** ${v}.0-draft\n\n## Abstract\n`
const specs = (over = {}) => Object.fromEntries(Object.entries(SPECS).map(([n, f]) => [`${S}${f}`, head(over[n] ?? '0.10')]))

test('the README status line must name the current castings', () => {
  const root = repo({ ...specs({ Trust: '0.32' }), 'README.md': 'Converged: Trust Layer 0.31 · Access Layer\n0.10.\n', 'lib/README.md': '' })
  const { errors, stale } = checkVersions(root)
  assert.deepEqual(stale, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].msg, /names Trust Layer 0\.31, trust-layer\.md is at 0\.32/)
  assert.equal(errors[0].line, 1)
})

test('the library README may lag a casting (stale), never lead it (error); section numbers are no versions', () => {
  const root = repo({ ...specs({ Identity: '0.55' }), 'README.md': '', 'lib/README.md': 'Identity 0.54 §6.1, Access 3.4, Delivery 0.11\n' })
  const { errors, stale } = checkVersions(root)
  assert.deepEqual(stale.map((s) => s.msg), ['names Identity 0.54, identity-layer.md is at 0.55'])
  assert.deepEqual(errors.map((e) => e.msg), ['names Delivery 0.11, but delivery-contract.md is at 0.10'])
})
