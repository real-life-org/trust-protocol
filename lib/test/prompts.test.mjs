#!/usr/bin/env node
// Prompts (lib Stage 2, PR 2; design note §2.1 prompts, §4.4, §4.5): the
// human's open decisions, closed by the one human act `decide`. Domain
// modules open prompts later; the tests open them through the ./testing
// helper module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHolder, seedKeys, InfraError, StateCodecError } from '../dist/index.js'
import { promptsView, decodeState } from '../dist/internal.js'
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
    const r = await h.decide('p1', choice, { when: T0 + 5, actId: 'a1' })
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
  const again = await h.decide('p1', 'accept', { when: T0, actId: 'a1' })
  assert.deepEqual(again, r, 'the same act, replayed from the journal')
})

test('prompts: a repeated actId replays the result without a new commit; another choice is actid-conflict', async () => {
  const { h } = await make()
  await open(h, 'p1')
  const r = await h.decide('p1', 'accept', { when: T0, actId: 'a1' })
  const seq = (await h.snapshot()).commitSeq
  const again = await h.decide('p1', 'accept', { when: T0 + 10, actId: 'a1' })
  assert.deepEqual(again, r)
  assert.equal((await h.snapshot()).commitSeq, seq)
  assert.deepEqual(await h.decide('p1', 'decline', { when: T0, actId: 'a1' }), { ok: false, code: 'actid-conflict' })
  assert.deepEqual(await h.decide('p1', 'accept', { when: T0 }), { ok: false, code: 'actid-missing' })
})

test('prompts: an unknown prompt is refused (unknown-prompt) and nothing commits', async () => {
  const { h, store } = await make()
  await open(h, 'p1')
  const v = (await store.read()).version
  assert.deepEqual(await h.decide('nope', 'accept', { when: T0, actId: 'a1' }), { ok: false, code: 'unknown-prompt' })
  assert.deepEqual(await h.decide('__proto__', 'accept', { when: T0, actId: 'a2' }), { ok: false, code: 'unknown-prompt' })
  assert.equal((await store.read()).version, v)
})

test('prompts: an expired prompt is refused (prompt-expired) and removed by tick', async () => {
  const { h, store } = await make()
  await open(h, 'p1', { expiresAt: T0 + 1000 })
  const v = (await store.read()).version
  assert.deepEqual(await h.decide('p1', 'accept', { when: T0 + 1000, actId: 'a1' }), { ok: false, code: 'prompt-expired' })
  assert.equal((await store.read()).version, v, 'a refusal commits nothing')
  assert.equal((await h.prompts()).length, 1, 'the expired prompt stays until tick')
  await h.tick(T0 + 1000)
  assert.deepEqual(await h.prompts(), [])
  assert.deepEqual(await h.decide('p1', 'accept', { when: T0 + 1001, actId: 'a2' }), { ok: false, code: 'unknown-prompt' })
})

test('prompts: a decision just before expiry goes through', async () => {
  const { h } = await make()
  await open(h, 'p1', { expiresAt: T0 + 1000 })
  assert.equal((await h.decide('p1', 'decline', { when: T0 + 999, actId: 'a1' })).ok, true)
})

test('prompts: a lower when is raised to lastWhen before the expiry check', async () => {
  const { h } = await make()
  await open(h, 'p1', { expiresAt: T0 + 1000 })
  await h.tick(T0 + 999)
  await open(h, 'p2', { expiresAt: T0 + 500 })   // opened at the raised when, already past its expiry
  assert.deepEqual(await h.decide('p2', 'accept', { when: T0, actId: 'a1' }), { ok: false, code: 'prompt-expired' })
})

test('prompts: a malformed decision is a programming error and throws', async () => {
  const { h } = await make()
  await open(h, 'p1')
  await assert.rejects(h.decide('p1', 'maybe', { when: T0, actId: 'a1' }), TypeError)
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
  await assert.rejects(h.decide('p1', 'accept', { when: T0, actId: 'a1' }), (e) => e instanceof InfraError && e.code === 'commit-conflict')
  assert.deepEqual(seen, [], 'no event for a commit that did not land')
  assert.equal((await h.prompts()).length, 1)
  const r = await h.decide('p1', 'accept', { when: T0, actId: 'a1' })
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
  await h.decide('p1', 'decline', { when: T0, actId: 'a1' })
  const raw = (await store.read()).state
  assert.equal(decodeState(raw).acts.a1.events[0].choice, 'decline')
  raw.acts.a1.events[0].choice = 'maybe'
  assert.throws(() => decodeState(raw), (e) => e instanceof StateCodecError && e.code === 'shape')
})

test('prompts: a replay after a new holder over the same store returns the journaled decision', async () => {
  const store = new InMemoryStore()
  const { h } = await make(store)
  await open(h, 'p1')
  const r = await h.decide('p1', 'accept', { when: T0, actId: 'a1' })
  const seq = (await h.snapshot()).commitSeq
  const { h: h2 } = await make(store)
  assert.deepEqual(await h2.decide('p1', 'accept', { when: T0 + 50, actId: 'a1' }), r)
  assert.equal((await h2.snapshot()).commitSeq, seq, 'no second commit')
  assert.deepEqual(await h2.decide('p1', 'decline', { when: T0, actId: 'a1' }), { ok: false, code: 'actid-conflict' })
})

// ── decision handlers per prompt kind ──────────────────────────────────

const KA = 'z6LSbysY2xFMRpGMhb7tFTLMpeuPRaqaWM1yECx2AtzE3KCc'
const OWN = 'z6LSownOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwnOwn'

/** A domain module that answers group invites: accept sends a document
 *  and announces group.joined; decline refuses while `refuse` is set. */
const inviteModule = (seen = {}) => ({
  name: 'fake-invites',
  commands: {},
  decisions: {
    'group-invite' (state, prompt, choice, when) {
      seen.args = { prompt, choice, when, open: Object.hasOwn(state.prompts, prompt.id) }
      if (choice === 'decline' && seen.refuse) return { ok: false, code: 'in-flight' }
      if (choice === 'decline') return { state }
      const digest = 'uJoin' + prompt.id
      return {
        state: { ...state, encounter: { ...state.encounter, records: { ...state.encounter.records, [prompt.id]: { joined: prompt.groupId } } } },
        outbound: [{ digest, envelope: { rkid: KA, epk: 'e', nonce: 'n', ciphertext: 'c' }, type: 'https://real-life.org/trust-tasks/join/0.1', threadId: prompt.id, recipient: { contactId: prompt.contactId, rkid: OWN, keyAgreement: KA } }],
        events: [{ type: 'group.joined', groupId: prompt.groupId }],
      }
    },
  },
})

test('prompts: the decision handler of the prompt kind runs in the same commit as the closing', async () => {
  const seen = {}
  const store = new InMemoryStore()
  const h = await createHolder({ store, keys }, { modules: [openPromptModule, inviteModule(seen)] })
  await open(h, 'p1')
  const commits = []
  h.subscribe((c) => commits.push(c))
  const r = await h.decide('p1', 'accept', { when: T0 + 3, actId: 'a1' })
  assert.equal(r.ok, true)
  assert.deepEqual(seen.args.choice, 'accept')
  assert.equal(seen.args.prompt.id, 'p1')
  assert.equal(seen.args.when, T0 + 3)
  assert.equal(seen.args.open, true, 'the handler sees the prompt still open')
  assert.deepEqual(r.outbound.map((o) => [o.digest, o.attempt]), [['uJoinp1', 1]])
  assert.deepEqual(r.events.map((e) => e.type), ['group.joined', 'prompt.decided'])
  assert.equal(commits.length, 1, 'one commit')
  const { state } = await h.snapshot()
  const raw = (await store.read()).state
  assert.deepEqual(raw.prompts, {})
  assert.deepEqual(raw.encounter.records.p1, { joined: 'g1' })
  assert.ok(raw.outbox.uJoinp1)
  assert.equal(raw.acts.a1.outboundDigests[0], 'uJoinp1')
  assert.ok(state)
})

test('prompts: a handler refusal refuses the decision; nothing commits, the prompt stays', async () => {
  const seen = { refuse: true }
  const store = new InMemoryStore()
  const h = await createHolder({ store, keys }, { modules: [openPromptModule, inviteModule(seen)] })
  await open(h, 'p1')
  const v = (await store.read()).version
  assert.deepEqual(await h.decide('p1', 'decline', { when: T0, actId: 'a1' }), { ok: false, code: 'in-flight' })
  assert.equal((await store.read()).version, v)
  assert.equal((await h.prompts()).length, 1)
})

test('prompts: a kind without a handler only closes; another kind is untouched by the handler', async () => {
  const seen = {}
  const h = await createHolder({ store: new InMemoryStore(), keys }, { modules: [openPromptModule, inviteModule(seen)] })
  await open(h, 'p1', { kind: 'introduction' })
  const r = await h.decide('p1', 'accept', { when: T0, actId: 'a1' })
  assert.deepEqual(r.events.map((e) => [e.type, e.kind]), [['prompt.decided', 'introduction']])
  assert.equal(seen.args, undefined)
})

test('prompts: two modules registering a decision for one kind throw at construction', async () => {
  const a = inviteModule()
  const b = { ...inviteModule(), name: 'other-invites' }
  await assert.rejects(createHolder({ store: new InMemoryStore(), keys }, { modules: [a, b] }), /duplicate decision handler group-invite/)
  await assert.rejects(createHolder({ store: new InMemoryStore(), keys }, { modules: [{ name: 'x', commands: {}, decisions: { 'no-such-kind': () => ({}) } }] }), /unknown prompt kind/)
  await assert.rejects(createHolder({ store: new InMemoryStore(), keys }, { modules: [{ name: 'y', commands: {}, decisions: { introduction: 7 } }] }), TypeError)
})

test('prompts: a prepared decision handler — its preparation runs against the snapshot with the prompt open, its value reaches apply; none for an unknown or expired prompt', async () => {
  const seen = { prepares: 0 }
  const signer = {
    name: 'signer',
    commands: {},
    decisions: {
      introduction: {
        async prepare (ctx, prompt, choice) {
          seen.prepares++
          seen.open = Object.hasOwn(ctx.snapshot.prompts, prompt.id)
          return { sig: await ctx.keys.sign('pair/uEiAWsYVUPUcBzOXxQTOvqh_E0zB82rhb3vcwT0k3-kB_Fw', new TextEncoder().encode(prompt.id + choice)) }
        },
        apply (state, prompt, choice, when, prepared) {
          seen.value = prepared.value
          seen.bound = prepared.commitSeq === state.commitSeq
          return { state }
        },
      },
    },
  }
  const store = new InMemoryStore()
  const h = await createHolder({ store, keys }, { modules: [openPromptModule, signer] })
  await open(h, 'p1', { kind: 'introduction' })
  const r = await h.decide('p1', 'accept', { when: T0 + 1, actId: 'a1' })
  assert.equal(r.ok, true)
  assert.equal(seen.prepares, 1)
  assert.equal(seen.open, true)
  assert.equal(seen.bound, true, 'bound to the snapshot apply sees')
  assert.equal(seen.value.sig.length, 64)
  assert.deepEqual(await h.decide('nope', 'accept', { when: T0 + 2, actId: 'a2' }), { ok: false, code: 'unknown-prompt' })
  await open(h, 'p2', { kind: 'introduction', expiresAt: T0 + 5 })
  assert.deepEqual(await h.decide('p2', 'accept', { when: T0 + 10, actId: 'a3' }), { ok: false, code: 'prompt-expired' })
  assert.equal(seen.prepares, 1, 'no preparation for an unknown or expired prompt')
  await assert.rejects(createHolder({ store: new InMemoryStore(), keys }, { modules: [{ name: 'z', commands: {}, decisions: { introduction: { prepare: async () => 1 } } }] }), TypeError)
})
