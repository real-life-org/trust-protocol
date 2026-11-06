#!/usr/bin/env node
// DEVIATIONS.md is the register of every reading the library takes against
// the specification's text. Two directions must hold: a `DEVIATION <id>`
// marker in src/ without a row is an unregistered deviation; a row that
// names code without a marker in that code has lost its anchor. A pending
// row (no code yet) is allowed until the code that carries it lands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
export function rows () {
  const md = readFileSync(join(root, 'DEVIATIONS.md'), 'utf8')
  return md.split('\n').filter((l) => /^\| D\d+ \|/.test(l)).map((l) => {
    const [, id, issue, code, since] = l.split('|').map((c) => c.trim())
    return { id, issue, since, code: code === 'pending' ? [] : code.split(',').map((c) => c.trim().replace(/`/g, '')) }
  })
}
function files (dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []
  })
}
const markers = () => {
  const out = new Map()
  for (const f of files(join(root, 'src'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/DEVIATION (D\d+)\b/g)) {
      const where = f.slice(root.length)
      if (!(out.get(m[1]) ?? []).includes(where)) out.set(m[1], [...(out.get(m[1]) ?? []), where])
    }
  }
  return out
}

test('every DEVIATION marker in src/ has a row in DEVIATIONS.md', () => {
  const ids = new Set(rows().map((r) => r.id))
  for (const [id, where] of markers()) assert.ok(ids.has(id), `${id} is marked in ${where.join(', ')} but has no row`)
})

test('every row that names code has its marker in exactly those files', () => {
  const found = markers()
  for (const r of rows()) {
    if (r.code.length === 0) continue
    assert.deepEqual([...(found.get(r.id) ?? [])].sort(), [...r.code].sort(), `${r.id}: rows says ${r.code.join(', ')}`)
  }
})

test('every row names an issue of this repository and a version', () => {
  for (const r of rows()) {
    assert.match(r.issue, /^https:\/\/github\.com\/real-life-org\/trust-protocol\/issues\/\d+$/, r.id)
    assert.match(r.since, /^\d+\.\d+\.\d+$/, r.id)
  }
})
