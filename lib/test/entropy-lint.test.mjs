#!/usr/bin/env node
// Entropy lint (lib Stage 2, PR 1; design note §3 Entropy): randomness
// enters the library through the Entropy port only — src/entropy.ts is
// the one file that may touch the platform's generators.
//
// A hit is a line that uses getRandomValues, randomUUID or Math.random,
// or that uses crypto.ts's `rand` under any name: a call `rand(` (also
// `C.rand(`), or any use of a local alias bound by `rand as X` in an
// import.
//
// Two documented exceptions remain, with exact hit counts: crypto.ts's
// rand() itself (the primitive the pure builders take as their default
// source where a caller passes none) and seal()'s fallback in delivery.ts
// (the ephemeral seed and the nonce when no SealEntropy is given). The
// holder never reaches either: every draw of its acts goes through the
// Entropy port. A new file with hits fails, and so does any other count.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))
const ONLY = 'entropy.ts'
const INVENTORY = {
  'crypto.ts': 1,              // rand itself
  'delivery.ts': 2,            // seal(): ephemeral seed and nonce fallbacks
}

const DIRECT = /getRandomValues|randomUUID|Math\.random|\brand\(/

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
})

/** hits of one source text: direct uses plus every use of an alias of rand */
const hitsIn = (text) => {
  const aliases = [...text.matchAll(/\brand\s+as\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  const alias = aliases.length ? new RegExp(`(?<![\\w$.])(${aliases.join('|')})\\b`) : null
  const out = []
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return
    if (DIRECT.test(line) || /\brand\s+as\s+/.test(line) || (alias && alias.test(line))) out.push({ line: i + 1, text: line.trim() })
  })
  return out
}

const hits = new Map()
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split('\\').join('/')
  if (rel === ONLY) continue
  const h = hitsIn(readFileSync(file, 'utf8'))
  if (h.length) hits.set(rel, h)
}

test('entropy lint: the detector sees direct uses, calls of rand and aliases of it', () => {
  assert.equal(hitsIn("const x = globalThis.crypto.randomUUID()").length, 1)
  assert.equal(hitsIn("const b = C.rand(32)").length, 1)
  assert.equal(hitsIn("import { sha, rand as r0 } from '../crypto.js'\nconst f = i.rand ?? r0\nconst g = r0(3)\nconst ok = car0(1)").length, 3)
  assert.equal(hitsIn("// rand(3) in a comment\nconst brand = 1\nconst y = i.rand").length, 0)
})

test('entropy lint: no randomness outside entropy.ts except crypto.ts\'s rand() and seal()\'s fallback in delivery.ts', (t) => {
  for (const [rel, h] of [...hits].sort()) {
    t.diagnostic(`${rel}: ${h.length}`)
    for (const x of h) t.diagnostic(`  ${rel}:${x.line}  ${x.text.slice(0, 100)}`)
  }
  const unlisted = [...hits.keys()].filter((rel) => !Object.hasOwn(INVENTORY, rel))
  assert.deepEqual(unlisted, [], 'randomness outside the Entropy port and the inventory')
  const counts = Object.fromEntries(Object.keys(INVENTORY).map((rel) => [rel, hits.get(rel)?.length ?? 0]))
  assert.deepEqual(counts, INVENTORY, 'exactly one rand() in crypto.ts and the two fallbacks of seal() in delivery.ts')
})

test('entropy lint: entropy.ts is where the generators live', () => {
  const src = readFileSync(join(SRC, ONLY), 'utf8')
  assert.match(src, /getRandomValues/)
  assert.match(src, /randomUUID/)
})
