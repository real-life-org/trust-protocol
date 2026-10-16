#!/usr/bin/env node
// invariants-coverage (lib Stage 2, PR 5; note §4.7): two generator runs
// (invariants-fixture.mjs) whose coverage is asserted, not only logged —
// a star of several chunks completed (1030 admitted stand-ins, seed 22, a
// short run: the state is large), and on seed 37 a scripted prelude
// (lagScript) whose re-issue waits for the entry's head at a rotation and
// is released once the relationship presents it (6596), then random
// steps: recover, the horizon's give-ups, the
// retention, crafted conflicting chunks discarded (5260, 5366) and the
// group star in two chunks completed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './invariants-fixture.mjs'

if (!process.env.INV_SWEEP) {
  const counters = {}
  const add = (w) => { for (const [k, x] of Object.entries(w.counters)) counters[k] = (counters[k] ?? 0) + x }
  test('invariants: generator, seed 22 with 1030 admitted stand-ins — the star goes and completes in several chunks (5200, 5660)', async () => {
    const w = await run(22, { big: true, steps: 50 })
    add(w)
    assert.ok(w.counters.multiChunkStarAccepted > 0, JSON.stringify(w.counters))
  })
  test('invariants: generator, seed 37 with the 6596 prelude — a re-issue waiting for H opens at a rotation and is released, then 220 random steps', async () => {
    const w = await run(37, { script: true })
    add(w)
    assert.ok(w.counters.awaitOpened > 0 && w.counters.awaitReleased > 0, JSON.stringify(w.counters))
  })
  test('invariants: the coverage runs reached every injected and provoked case', () => {
    for (const k of ['recover', 'horizon', 'gaveUp', 'retained', 'retentionJump', 'disposition.discarded', 'multiChunkGroupStarAccepted', 'multiChunkStarAccepted', 'awaitOpened', 'awaitReleased', 'rotate']) {
      assert.ok((counters[k] ?? 0) > 0, `reached ${k}: ${JSON.stringify(counters)}`)
    }
  })
}
