// The public surface of the package, entry point by entry point (test/exports.json). A new, renamed or
// removed export fails here until the inventory is updated in the same change, so a reviewer sees every
// change to what hosts can reach. Before adding an export, ask: does it hand a host key material or the
// root (a raw secret, a private key, an HKDF info prefix), or state a host should read from a view? Then
// it needs a capability or a view field instead.
// Regenerate: node test/exports.test.mjs --write
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

const ENTRIES = { '.': '../dist/index.js', './testing': '../dist/testing.js', './internal': '../dist/internal.js', './adapters/vti-mediator': '../dist/adapters/vti-mediator.js' }
const FILE = new URL('./exports.json', import.meta.url)

async function surface () {
  const out = {}
  for (const [entry, path] of Object.entries(ENTRIES)) out[entry] = Object.keys(await import(path)).sort()
  return out
}

if (process.argv.includes('--write')) {
  writeFileSync(FILE, JSON.stringify(await surface(), null, 1) + '\n')
} else {
  test('the exports of every entry point match the inventory (test/exports.json)', async () => {
    const want = JSON.parse(readFileSync(FILE, 'utf8'))
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(pkg.exports).sort(), Object.keys(ENTRIES).sort(), 'every entry point of package.json is listed here')
    const have = await surface()
    for (const entry of Object.keys(ENTRIES)) {
      const added = have[entry].filter((n) => !want[entry]?.includes(n))
      const removed = (want[entry] ?? []).filter((n) => !have[entry].includes(n))
      assert.deepEqual({ added, removed }, { added: [], removed: [] }, `exports of ${entry} changed: update test/exports.json in the same change`)
    }
  })
}
