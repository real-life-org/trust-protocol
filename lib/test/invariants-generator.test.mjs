#!/usr/bin/env node
// invariants-generator (lib Stage 2, PR 5; note §4.7): the property-based
// generator of invariants-fixture.mjs on seeds 4–6 and two runs with
// restarts and lost commit answers (seeds 12, 13); beside
// invariants.test.mjs so the two run in parallel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './invariants-fixture.mjs'

if (!process.env.INV_SWEEP) {
  for (const seed of [4, 5, 6]) {
    test(`invariants: generator, seed ${seed} — 220 random steps over three holders, every invariant after each`, async () => {
      const w = await run(seed)
      assert.ok((w.counters.receive ?? 0) + (w.counters.flush ?? 0) > 20 && w.counters.act > 20, `the run exercised the holders: ${JSON.stringify(w.counters)}`)
    })
  }
  for (const seed of [12, 13]) {
    test(`invariants: generator with restarts and lost commit answers, seed ${seed}`, async () => {
      const w = await run(seed, { restarts: true, lossy: true })
      assert.ok(w.counters.restart > 0 && w.persons.some((p) => p.store.lost > 0), `restarts and lost answers happened: ${JSON.stringify(w.counters)}`)
    })
  }
}
