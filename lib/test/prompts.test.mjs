#!/usr/bin/env node
// Prompts (lib Stage 2, PR 2; design note §2.1 prompts, §4.4, §4.5): the
// human's open decisions, closed by the one human act `decide`. Domain
// modules open prompts later; the tests open them through the ./testing
// helper module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, seedKeys, promptsView, InfraError, decodeState, StateCodecError } from '../dist/index.js'
import { InMemoryStore, openPromptModule, OPEN_PROMPT } from '../dist/testing.js'

const keys = seedKeys(new Uint8Array(64).fill(7))
const T0 = Date.parse('2026-10-14T12:00:00Z')

/** A store that records the commitSeq it holds, and can fail one commit. */
class WatchedStore extends InMemoryStore {
  held = null
  fail = false
  async commit (version, next) {
    if (this.fail) { this.fail = false; return { ok: false, reason: 'conflict' } }
    const r = await super.commit(version, next)
    if (r.ok) this.held = next.commitSeq
    return r
  }
}

const make = async (store = new InMemoryStore(), retry) => {
  const h = await createHolder({ store, keys, ...(retry ? { retry } : {}) }, { modules: [openPromptModule] })
  return { h, store }
}

const open = (h, id, extra = {}) => h.act(OPEN_PROMPT, { id, kind: 'group-invite', groupId: 'g1', contactId: 'c1', ...extra }, T0)

test('prompts: the testing module opens a prompt and announces prompt.opened', async () => {
  const { h } = await make()
  const r = await open(h, 'p1', { expiresAt: T0 + 1000 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.events.map((e) => [e.type, e.promptId, e.kind]), [['prompt.opened', 'p1', 'group-invite']])
  const [p] = await h.prompts()
  assert.deepEqual({ ...p, commitSeq: undefined }, { commitSeq: undefined, id: 'p1', kind: 'group-invite', contactId: 'c1', groupId: 'g1', openedAt: T0, expiresAt: T0 + 1000 })
})

for (const choice of ['accept', 'decline']) {
  test(`prompts: decide ${choice} removes the prompt and announces prompt.decided`, async () => {
    const { h } = await make()
    await open(h, 'p1')
    const r = await h.decide('p1', choice, T0 + 5, { actId: 'a1' })
    assert.equal(r.ok, true)
    assert.deepEqual(r.outbound, [])
    assert.deepEqual(r.events.map((e) => [e.type, e.promptId, e.kind, e.choice, e.actId]), [['prompt.decided', 'p1', 'group-invite', choice, 'a1']])
    assert.deepEqual(await h.prompts(), [])
    assert.equal(r.events[0].commitSeq, (await h.snapshot()).commitSeq)
  })
}

test('prompts: decide is the command prompt.decide; act reaches the same act', async () => {
  const { h } = await make()
  await open(h, 'p1')
  const r = await h.act('prompt.decide', { promptId: 'p1', choice: 'accept' }, T0, { actId: 'a1' })
  assert.equal(r.ok, true)
  const again = await h.decide('p1', 'accept', T0, { actId: 'a1' })
  assert.deepEqual(again, r, 'the same act, replayed from the journal')
})

test('prompts: a repeated actId replays the result without a new commit; another choice is actid-conflict', async () => {
  const { h } = await make()
  await open(h, 'p1')
  const r = await h.decide('p1', 'accept', T0, { actId: 'a1' })
  const seq = (await h.snapshot()).commitSeq
  const again = await h.decide('p1', 'accept', T0 + 10, { actId: 'a1' })
  assert.deepEqual(again, r)
  assert.equal((await h.snapshot()).commitSeq, seq)
  assert.deepEqual(await h.decide('p1', 'decline', T0, { actId: 'a1' }), { ok: false, code: 'actid-conflict' })
  assert.deepEqual(await h.decide('p1', 'accept', T0), { ok: false, code: 'actid-missing' })
})

test('prompts: an unknown prompt is refused (unknown-prompt) and nothing commits', async () => {
  const { h, store } = await make()
  await open(h, 'p1')
  const v = (await store.read()).version
  assert.deepEqual(await h.decide('nope', 'accept', T0, { actId: 'a1' }), { ok: false, code: 'unknown-prompt' })
  assert.deepEqual(await h.decide('__proto__', 'accept', T0, { actId: 'a2' }), { ok: false, code: 'unknown-prompt' })
  assert.equal((await store.read()).version, v)
})

test('prompts: an expired prompt is refused (prompt-expired) and removed by tick', async () => {
  const { h, store } = await make()
  await open(h, 'p1', { expiresAt: T0 + 1000 })
  const v = (await store.read()).version
  assert.deepEqual(await h.decide('p1', 'accept', T0 + 1000, { actId: 'a1' }), { ok: false, code: 'prompt-expired' })
  assert.equal((await store.read()).version, v, 'a refusal commits nothing')
  assert.equal((await h.prompts()).length, 1, 'the expired prompt stays until tick')
  await h.tick(T0 + 1000)
  assert.deepEqual(await h.prompts(), [])
  assert.deepEqual(await h.decide('p1', 'accept', T0 + 1001, { actId: 'a2' }), { ok: false, code: 'unknown-prompt' })
})

test('prompts: a decision just before expiry goes through', async () => {
  const { h } = await make()
  await open(h, 'p1', { expiresAt: T0 + 1000 })
  assert.equal((await h.decide('p1', 'decline', T0 + 999, { actId: 'a1' })).ok, true)
})

test('prompts: a lower when is raised to lastWhen before the expiry check', async () => {
  const { h } = await make()
  await open(h, 'p1', { expiresAt: T0 + 1000 })
  await h.tick(T0 + 999)
  await open(h, 'p2', { expiresAt: T0 + 500 })   // opened at the raised when, already past its expiry
  assert.deepEqual(await h.decide('p2', 'accept', T0, { actId: 'a1' }), { ok: false, code: 'prompt-expired' })
})

test('prompts: a malformed decision is a programming error and throws', async () => {
  const { h } = await make()
  await open(h, 'p1')
  await assert.rejects(h.decide('p1', 'maybe', T0, { actId: 'a1' }), TypeError)
  await assert.rejects(h.act('prompt.decide', { promptId: 7, choice: 'accept' }, T0, { actId: 'a2' }), TypeError)
  assert.equal((await h.prompts()).length, 1)
})

test('prompts: prompt.decided is announced only after the commit, never for a failed one', async () => {
  const store = new WatchedStore()
  const { h } = await make(store, { commitAttempts: 1 })
  await open(h, 'p1')
  const seen = []
  h.subscribe((c) => seen.push({ ...c, held: store.held }))
  store.fail = true
  await assert.rejects(h.decide('p1', 'accept', T0, { actId: 'a1' }), (e) => e instanceof InfraError && e.code === 'commit-conflict')
  assert.deepEqual(seen, [], 'no event for a commit that did not land')
  assert.equal((await h.prompts()).length, 1)
  const r = await h.decide('p1', 'accept', T0, { actId: 'a1' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].held, seen[0].commitSeq, 'the store held the commit when the listener ran')
  assert.deepEqual(seen[0].events, r.events)
  assert.equal(seen[0].events[0].type, 'prompt.decided')
})

test('prompts: promptsView is pure over the state the holder committed', async () => {
  const { h } = await make()
  await open(h, 'p2')
  await open(h, 'p1')
  const { state } = await h.snapshot()
  assert.deepEqual(promptsView(state).map((p) => p.id), ['p1', 'p2'], 'same opening time: by id')
})

test('prompts: the journal keeps prompt.decided under the codec; a foreign choice is refused', async () => {
  const { h, store } = await make()
  await open(h, 'p1')
  await h.decide('p1', 'decline', T0, { actId: 'a1' })
  const raw = (await store.read()).state
  assert.equal(decodeState(raw).acts.a1.events[0].choice, 'decline')
  raw.acts.a1.events[0].choice = 'maybe'
  assert.throws(() => decodeState(raw), (e) => e instanceof StateCodecError && e.code === 'shape')
})
