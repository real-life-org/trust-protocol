#!/usr/bin/env node
// The Store contract (lib Stage 2, PR 1; design note §3 Store), run
// against the in-memory reference store. App and simulator adapters run
// the same exported suite against theirs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InMemoryStore, storeContract } from '../dist/testing.js'

storeContract(() => new InMemoryStore(), { test, assert })

test('InMemoryStore: version tokens are opaque strings that change on every commit', async () => {
  const s = new InMemoryStore()
  const { version: v0 } = await s.read()
  assert.equal(v0, null)
  const { CODEC } = await import('../dist/index.js')
  const { emptyState } = await import('../dist/testing.js')
  const r1 = await s.commit(v0, emptyState(CODEC))
  const r2 = await s.commit(r1.version, emptyState(CODEC))
  assert.equal(typeof r1.version, 'string')
  assert.notEqual(r1.version, r2.version)
})
