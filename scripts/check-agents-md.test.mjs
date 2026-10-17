// Probes for scripts/check-agents-md.mjs.
//   usage: node --test scripts/check-agents-md.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAgents } from './check-agents-md.mjs'

const tracked = [
  'AGENTS.md', 'CLAUDE.md', 'package.json', 'spec/a.md', 'scripts/validate.mjs',
  'lib/package.json', 'apps/site/package.json', 'apps/workbench/index.html', '.github/workflows/validate.yml',
]
const packages = {
  '': { scripts: { validate: 'x', 'check:lib': 'y' } },
  lib: { scripts: { build: 'x', test: 'y' } },
}
const ignored = ['lib/dist']
const layout = (dirs) => '## Repository Layout\n\n```text\n' + dirs.map((d) => `${d.padEnd(14)} what it holds`).join('\n') + '\n```\n'
const FULL = ['spec/', 'scripts/', 'lib/', 'apps/site/', 'apps/workbench/']
const run = (agents, claude = '') => checkAgents({ files: { 'AGENTS.md': agents, 'CLAUDE.md': claude }, tracked, packages, ignored })

test('a complete layout and existing references pass', () => {
  const agents = layout(FULL) + '\nRun `npm run validate`; see `.github/workflows/validate.yml` and `lib/dist`.\n\n```sh\ncd lib && npm run build && npm test && cd ..\nnode scripts/validate.mjs --check\n```\n'
  assert.deepEqual(run(agents, 'Use `npm run check:lib`; pages under `understand/` are relative.\nIn `lib/`, `npm test` runs the suite.'), [])
})

test('a directory missing from the layout is an error, also below apps/', () => {
  const errors = run(layout(['spec/', 'scripts/', 'apps/site/']))
  assert.deepEqual(errors.map((e) => e.msg), [
    'lib/ is not in the Repository Layout',
    'apps/workbench/ is not in the Repository Layout',
  ])
})

test('a referenced path that does not exist is an error, with file and line', () => {
  const errors = run(layout(FULL) + '\nsee `scripts/gone.mjs`\n', 'line one\nrun (`.github/workflows/old.yml`).')
  assert.deepEqual(errors.map((e) => [e.file, e.line, e.msg]), [
    ['AGENTS.md', 11, 'scripts/gone.mjs does not exist'],
    ['CLAUDE.md', 2, '.github/workflows/old.yml does not exist'],
  ])
})

test('npm run names a script of the package it runs in', () => {
  const errors = run(layout(FULL) + '\n```sh\nnpm run --silent check:generators\ncd lib && npm run validate\n```\n')
  assert.deepEqual(errors.map((e) => e.msg), [
    'npm run check:generators: no such script in package.json',
    'npm run validate: no such script in lib/package.json',
  ])
})

test('a path in a Markdown link is checked; a fragment or query after a path is not part of it', () => {
  const errors = run(layout(FULL) + '\nsee [workflow](.github/workflows/missing.yml) and [ok](scripts/validate.mjs)\nsee `scripts/validate.mjs#intro` and spec/a.md?plain=1\n')
  assert.deepEqual(errors.map((e) => [e.line, e.msg]), [[11, '.github/workflows/missing.yml does not exist']])
})
