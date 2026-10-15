#!/usr/bin/env node
// encounter-holder (lib Stage 2, PR 7a): the Encounter ceremony graduated
// onto HolderState (encounter/ceremony.ts) — show, scan, the bundle, the
// confirm prompt, the counter-step, both paths of 5.8, restarts,
// duplicates, forged cards, aging challenges, the signed ack — and the
// graduated chain (trust act, star) on ceremony-born tuples.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seedKeys, digestBytes, labeledContext, diSign, diSignWith, diVerify } from '../dist/index.js'

const T0 = Date.parse('2026-10-15T09:00:00Z')

test('crypto: diSignWith over the KeyProvider is byte-identical to diSign over the private key', async () => {
  const seed = new Uint8Array(64).fill(0x31)
  const keys = seedKeys(seed)
  const label = 'pair/' + await digestBytes(new Uint8Array(32).fill(7))
  const ctx = await labeledContext(seed, label)
  const doc = { '@context': ['https://www.w3.org/ns/credentials/v2'], hello: 'world', n: 1 }
  const created = '2026-10-15T09:00:00Z'
  const a = await diSign(ctx, doc, created)
  const b = await diSignWith(ctx.anchor, (bytes) => keys.sign(label, bytes), doc, created)
  assert.deepEqual(b, a)
  assert.equal(await diVerify(b, ctx.anchor), true)
  await assert.rejects(diSignWith(ctx.anchor, async () => new Uint8Array(63), doc, created), /64-byte/)
  assert.ok(T0)
})
