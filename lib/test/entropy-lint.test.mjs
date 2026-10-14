#!/usr/bin/env node
// Entropy lint (lib Stage 2, PR 1; design note §3 Entropy): randomness
// enters the library through the Entropy port only — src/entropy.ts is
// the one file that may touch the platform's generators. Direct hits
// (getRandomValues, randomUUID, Math.random) and calls of crypto.ts's
// `rand` count.
//
// TODO(PR 3/4 of the Stage-2 note, rltp/design/lib-stufe-2-form-2026-10.md
// §5): probe/ is excluded and crypto.ts/delivery.ts are allowlisted
// while the probe modules and seal() still draw their own entropy. The
// exclusion and the allowlist shrink as those modules move to the port;
// the test prints every excluded hit so the remaining debt stays visible.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const PATTERN = /getRandomValues|randomUUID|Math\.random|\brand\(/
const ONLY = 'entropy.ts'
const EXCLUDED_DIR = 'probe/'
const ALLOW = new Set(['crypto.ts', 'delivery.ts'])

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
})

const hits = []
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/')
  if (rel === ONLY) continue
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (PATTERN.test(line) && !/^\s*(\/\/|\*)/.test(line)) hits.push({ rel, line: i + 1, text: line.trim() })
  })
}

test('entropy lint: no randomness outside entropy.ts (except the listed debt)', (t) => {
  const debt = hits.filter((h) => h.rel.startsWith(EXCLUDED_DIR) || ALLOW.has(h.rel))
  const files = [...new Set(debt.map((h) => h.rel))].sort()
  t.diagnostic('excluded/allowlisted files still drawing their own entropy: ' + files.join(', '))
  for (const h of debt) t.diagnostic(`  ${h.rel}:${h.line}  ${h.text.slice(0, 100)}`)
  const offenders = hits.filter((h) => !debt.includes(h))
  assert.deepEqual(offenders.map((h) => `${h.rel}:${h.line}`), [], 'randomness outside the Entropy port')
})

test('entropy lint: every allowlisted file still has a hit (the allowlist does not go stale)', () => {
  for (const f of ALLOW) assert.ok(hits.some((h) => h.rel === f), f + ' no longer draws entropy — remove it from ALLOW')
})

test('entropy lint: entropy.ts is where the generators live', () => {
  const src = readFileSync(join(SRC, ONLY), 'utf8')
  assert.match(src, /getRandomValues/)
  assert.match(src, /randomUUID/)
})
