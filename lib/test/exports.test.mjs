// The runtime surface of the package, entry point by entry point (test/exports.json): every subpath
// package.json exports, imported by the package name as a host imports it, with the members of every
// exported namespace object (`sharedConnect.peer2Of`). A new, renamed or removed name fails here until
// the inventory is updated in the same change, so a reviewer sees every change to what hosts can reach.
// Types are not runtime values and are not listed. Before adding an export, ask: does it hand a host key
// material or the root (a raw secret, a private key, an HKDF info prefix), or state a host should read
// from a view? Then it needs a capability or a view field instead.
// Regenerate: node test/exports.test.mjs --write
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('./exports.json', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const isNamespace = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === null || Object.getPrototypeOf(v) === Object.prototype) && Object.values(v).some((m) => typeof m === 'function')
async function surface () {
  const out = {}
  for (const sub of Object.keys(pkg.exports).sort()) {
    const mod = await import(pkg.name + sub.slice(1))
    const names = []
    for (const [k, v] of Object.entries(mod)) {
      names.push(k)
      if (isNamespace(v)) for (const m of Object.keys(v)) names.push(k + '.' + m)
    }
    out[sub] = names.sort()
  }
  return out
}

if (process.argv.includes('--write')) {
  writeFileSync(FILE, JSON.stringify(await surface(), null, 1) + '\n')
} else {
  test('the runtime exports of every entry point match the inventory (test/exports.json)', async () => {
    const want = JSON.parse(readFileSync(FILE, 'utf8'))
    const have = await surface()
    assert.deepEqual(Object.keys(have), Object.keys(want), 'the entry points of package.json')
    for (const entry of Object.keys(have)) {
      const added = have[entry].filter((n) => !want[entry].includes(n))
      const removed = want[entry].filter((n) => !have[entry].includes(n))
      assert.deepEqual({ added, removed }, { added: [], removed: [] }, `exports of ${entry} changed: update test/exports.json in the same change`)
    }
  })
}
