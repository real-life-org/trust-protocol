#!/usr/bin/env node
// sha256 (lib Stage 2, PR 4b): the synchronous SHA-256 of sha256.ts — a
// scoped exception to "WebCrypto only" for local reconciliation views —
// checked differentially against node:crypto, and confined: no module
// but trust/star.ts and trust/group-star.ts imports it (view digests).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256Hex } from '../dist/sha256.js'

const ref = (s) => createHash('sha256').update(Buffer.from(new TextEncoder().encode(s))).digest('hex')

test('sha256: known answers', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
})

test('sha256: equals node:crypto for every length 0–2048, the padding boundaries included', () => {
  let s = ''
  for (let n = 0; n <= 2048; n++) {
    assert.equal(sha256Hex(s), ref(s), `length ${n}`)
    s += String.fromCharCode(0x20 + ((n * 7) % 95))
  }
  for (const n of [55, 56, 63, 64, 119, 120, 127, 128]) assert.equal(sha256Hex('x'.repeat(n)), ref('x'.repeat(n)), `boundary ${n}`)
})

test('sha256: UTF-8 text — multi-byte characters, surrogate pairs and lone surrogates (encoded as U+FFFD, like TextEncoder)', () => {
  const pieces = ['é', 'ß', '€', '漢', '😀', '👩‍👩‍👧', '\ud83d', '\ude00', 'a\ud800b', '\u0000']
  for (let i = 0; i < 400; i++) {
    let s = ''
    for (let j = 0; j < i % 37; j++) s += pieces[(i * 31 + j * 7) % pieces.length]
    assert.equal(sha256Hex(s), ref(s), JSON.stringify(s))
  }
})

test('sha256: a 1 MiB input', () => {
  const s = 'ab'.repeat(512 * 1024)
  assert.equal(sha256Hex(s), ref(s))
})

test('sha256: only the trust star modules import it — local view digests, never wire bytes, keys or MACs', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url))
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })
  const importers = walk(SRC).filter((p) => /from\s+'[./]*sha256\.js'/.test(readFileSync(p, 'utf8'))).map((p) => relative(SRC, p).split('\\').join('/'))
  const allowed = new Set(['trust/star.ts', 'trust/group-star.ts'])
  assert.deepEqual(importers.filter((f) => !allowed.has(f)), [], 'no other module imports it')
  assert.ok(importers.includes('trust/star.ts'))
})
