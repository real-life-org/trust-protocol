#!/usr/bin/env node
// Crypto at construction, never at import (lib Stage 2, PR 1; design
// note §3 Crypto): a runtime without globalThis.crypto can import the
// library; building a holder then fails with CryptoUnavailableError, or
// works when the app injects a handle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIST = new URL('../dist/', import.meta.url)
const run = (body) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
  delete globalThis.crypto
  const out = {}
  try { ${body} } catch (e) { out.thrown = { name: e.name, message: e.message } }
  console.log(JSON.stringify(out))
`], { encoding: 'utf8', env: { ...process.env, DIST: fileURLToPath(DIST) } }))

test('crypto: dist/index.js and dist/testing.js import without globalThis.crypto', () => {
  const out = run(`
    out.before = typeof globalThis.crypto
    const m = await import(process.env.DIST + 'index.js')
    await import(process.env.DIST + 'testing.js')
    out.ok = typeof m.createHolder === 'function'
  `)
  assert.deepEqual(out, { before: 'undefined', ok: true })
})

test('crypto: without a handle createHolder, seedKeys and randomEntropy throw CryptoUnavailableError', () => {
  const out = run(`
    const { createHolder, seedKeys, randomEntropy, CryptoUnavailableError } = await import(process.env.DIST + 'index.js')
    const { InMemoryStore } = await import(process.env.DIST + 'testing.js')
    const name = (f) => { try { f(); return 'none' } catch (e) { return e instanceof CryptoUnavailableError ? 'CU:' + e.missing.join(',') : e.name } }
    out.seedKeys = name(() => seedKeys(new Uint8Array(64)))
    out.entropy = name(() => randomEntropy())
    const fakeKeys = { anchorOf: async () => ({}), sign: async () => new Uint8Array(), agree: async () => ({ status: 'unknown' }), carrierPrincipal: async () => ({}) }
    try { await createHolder({ store: new InMemoryStore(), keys: fakeKeys }); out.holder = 'none' } catch (e) { out.holder = e instanceof CryptoUnavailableError ? 'CU' : e.name }
  `)
  assert.equal(out.seedKeys, 'CU:subtle')
  assert.equal(out.entropy, 'CU:getRandomValues,randomUUID')
  assert.equal(out.holder, 'CU')
})

test('crypto: an injected handle carries keys, entropy and the engine without the global', () => {
  const out = run(`
    const { webcrypto } = await import('node:crypto')
    const { createHolder, seedKeys } = await import(process.env.DIST + 'index.js')
    const { InMemoryStore } = await import(process.env.DIST + 'testing.js')
    const keys = seedKeys(new Uint8Array(64).fill(3), webcrypto)
    out.anchor = (await keys.anchorOf('persona/Anton')).anchor.slice(0, 9)
    const h = await createHolder({ store: new InMemoryStore(), keys, crypto: webcrypto }, { modules: [{ name: 'm', commands: { 'm.x': { human: true, prepare: async (ctx) => ctx.entropy.id('doc.id'), apply: (s) => ({ state: { ...s } }) } } }] })
    out.act = (await h.act('m.x', {}, 1, { actId: 'a' })).ok
  `)
  assert.deepEqual(out, { anchor: 'did:key:z', act: true })
})
